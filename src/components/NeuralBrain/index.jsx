import React, {
  useRef, useState, useMemo, useCallback, useEffect, Suspense,
} from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Stars, Text, Sparkles, Line } from '@react-three/drei'
import { EffectComposer, Bloom, ChromaticAberration } from '@react-three/postprocessing'
import * as THREE from 'three'
import { motion, AnimatePresence } from 'framer-motion'

// ─────────────────────────────────────────────────────────────
// GLSL SHADERS
// ─────────────────────────────────────────────────────────────

const BRAIN_VERT = /* glsl */`
  uniform float time;
  varying vec3 vNormal;
  varying vec3 vPosition;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  float noise3(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i), hash(i+vec3(1,0,0)), f.x),
          mix(hash(i+vec3(0,1,0)), hash(i+vec3(1,1,0)), f.x), f.y),
      mix(mix(hash(i+vec3(0,0,1)), hash(i+vec3(1,0,1)), f.x),
          mix(hash(i+vec3(0,1,1)), hash(i+vec3(1,1,1)), f.x), f.y),
      f.z
    );
  }

  void main() {
    vNormal = normalize(normalMatrix * normal);

    vec3 pos = position;
    // Organic brain surface pulsation
    float n1 = noise3(pos * 2.2 + time * 0.25);
    float n2 = noise3(pos * 4.8 - time * 0.18);
    float n3 = noise3(pos * 9.0 + time * 0.40);
    pos += normal * (n1 * 0.18 + n2 * 0.09 + n3 * 0.04);

    vPosition = pos;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`

const BRAIN_FRAG = /* glsl */`
  uniform float time;
  uniform vec3  baseColor;
  uniform vec3  glowColor;
  uniform float opacity;

  varying vec3 vNormal;
  varying vec3 vPosition;

  void main() {
    // Approximate fresnel from normal
    float fresnel = 1.0 - abs(dot(normalize(vNormal), vec3(0.0, 0.0, 1.0)));
    fresnel = pow(fresnel, 1.6);

    // Horizontal scan bands
    float scan = sin(vPosition.y * 14.0 + time * 2.5) * 0.5 + 0.5;
    scan = pow(scan, 7.0) * 0.45;

    // Neural pulse
    float pulse = 0.5 + 0.5 * sin(time * 1.8);

    // Occasional bright flash
    float flash = pow(max(0.0, sin(time * 0.7) * sin(time * 1.3)), 8.0) * 0.4;

    vec3 col = mix(baseColor, glowColor, fresnel * 0.75 + scan + pulse * 0.08 + flash);
    float alpha = opacity * (0.25 + fresnel * 0.55 + scan * 0.2 + flash);

    gl_FragColor = vec4(col, alpha);
  }
`

const NEURON_FRAG = /* glsl */`
  uniform float time;
  uniform vec3  color;
  uniform float pulse;
  uniform float selected;

  void main() {
    float p = 0.6 + 0.4 * sin(time * 3.0 + pulse * 6.28);
    float glow = selected > 0.5 ? 1.4 : 1.0;
    gl_FragColor = vec4(color * p * glow, p * (0.85 + selected * 0.15));
  }
`

const NEURON_VERT = /* glsl */`
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

function hexToVec3(hex) {
  const c = new THREE.Color(hex)
  return new THREE.Vector3(c.r, c.g, c.b)
}

function lerp3(a, b, t) {
  return new THREE.Vector3().lerpVectors(a, b, t)
}

// ─────────────────────────────────────────────────────────────
// BRAIN MESH
// ─────────────────────────────────────────────────────────────

function BrainMesh() {
  const geo = useMemo(() => new THREE.IcosahedronGeometry(1.55, 5), [])

  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader:   BRAIN_VERT,
        fragmentShader: BRAIN_FRAG,
        uniforms: {
          time:      { value: 0 },
          baseColor: { value: new THREE.Color('#001a3a') },
          glowColor: { value: new THREE.Color('#00e5ff') },
          opacity:   { value: 0.75 },
        },
        transparent: true,
        side:        THREE.FrontSide,
        depthWrite:  false,
      }),
    []
  )

  // Wireframe overlay
  const wireMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color:       '#00e5ff',
        wireframe:   true,
        transparent: true,
        opacity:     0.06,
      }),
    []
  )

  useFrame(({ clock }) => {
    mat.uniforms.time.value = clock.elapsedTime
  })

  return (
    <group>
      <mesh geometry={geo} material={mat} />
      <mesh geometry={geo} material={wireMat} scale={[1.005, 1.005, 1.005]} />
      {/* Outer soft glow sphere */}
      <mesh>
        <sphereGeometry args={[1.85, 32, 32]} />
        <meshBasicMaterial
          color="#00e5ff"
          transparent
          opacity={0.03}
          side={THREE.BackSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  )
}

// ─────────────────────────────────────────────────────────────
// SYNAPSE CONNECTION
// ─────────────────────────────────────────────────────────────

function SynapticLine({ from, to, active, pulseOffset = 0 }) {
  const lineRef = useRef()
  const dashRef = useRef(0)

  const mid = useMemo(() => {
    const m = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5)
    m.multiplyScalar(0.6) // bow toward center (brain)
    return m
  }, [from, to])

  const points = useMemo(() => {
    const curve = new THREE.QuadraticBezierCurve3(from, mid, to)
    return curve.getPoints(32)
  }, [from, to, mid])

  useFrame(({ clock }) => {
    dashRef.current = (clock.elapsedTime * 0.5 + pulseOffset) % 1.0
  })

  const lineColor = active ? '#00e5ff' : '#003344'
  const lineWidth = active ? 1.2 : 0.5
  const lineOpacity = active ? 0.7 : 0.25

  return (
    <Line
      points={points}
      color={lineColor}
      lineWidth={lineWidth}
      transparent
      opacity={lineOpacity}
      dashed={active}
      dashSize={0.12}
      gapSize={0.08}
    />
  )
}

// ─────────────────────────────────────────────────────────────
// DEPARTMENT NODE
// ─────────────────────────────────────────────────────────────

function DepartmentNode({ dept, orbitAngle, orbitRadius, orbitY, isSelected, onSelect, orbitSpeed }) {
  const groupRef = useRef()
  const glowRef  = useRef()
  const [hovered, setHovered] = useState(false)
  const posRef = useRef(new THREE.Vector3())

  useFrame(({ clock }) => {
    const t     = clock.elapsedTime
    const angle = orbitAngle + t * orbitSpeed
    const x     = Math.cos(angle) * orbitRadius
    const z     = Math.sin(angle) * orbitRadius
    const y     = orbitY + Math.sin(t * 0.6 + orbitAngle) * 0.15

    posRef.current.set(x, y, z)

    if (groupRef.current) {
      groupRef.current.position.set(x, y, z)
      groupRef.current.lookAt(0, 0, 0) // always faces brain center
    }

    if (glowRef.current) {
      const p = 0.7 + 0.3 * Math.sin(t * 2.0 + orbitAngle)
      glowRef.current.scale.setScalar(isSelected ? 1.4 + p * 0.1 : 1 + p * 0.08)
    }
  })

  const baseColor = dept.color ?? '#00e5ff'
  const scale     = isSelected ? 1.45 : hovered ? 1.2 : 1.0

  return (
    <group
      ref={groupRef}
      scale={[scale, scale, scale]}
      onClick={(e) => { e.stopPropagation(); onSelect(dept) }}
      onPointerOver={(e) => { e.stopPropagation(); setHovered(true) }}
      onPointerOut={() => setHovered(false)}
    >
      {/* Core sphere */}
      <mesh>
        <sphereGeometry args={[0.22, 16, 16]} />
        <meshBasicMaterial color={baseColor} />
      </mesh>

      {/* Pulsing ring */}
      <mesh ref={glowRef} rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.28, 0.34, 32]} />
        <meshBasicMaterial
          color={baseColor}
          transparent
          opacity={isSelected ? 0.9 : 0.5}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>

      {/* Glow halo */}
      <mesh>
        <sphereGeometry args={[0.45, 12, 12]} />
        <meshBasicMaterial
          color={baseColor}
          transparent
          opacity={isSelected ? 0.12 : hovered ? 0.09 : 0.04}
          side={THREE.BackSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>

      {/* Label */}
      <Text
        position={[0, 0.42, 0]}
        fontSize={0.13}
        color={isSelected ? baseColor : '#0088aa'}
        anchorX="center"
        anchorY="bottom"
        maxWidth={1.4}
      >
        {dept.name?.toUpperCase()}
      </Text>

      {/* Agent count badge */}
      <Text
        position={[0, 0.65, 0]}
        fontSize={0.09}
        color="#003344"
        anchorX="center"
        anchorY="bottom"
      >
        {dept.agents?.length ?? 0} AGENTS
      </Text>
    </group>
  )
}

// ─────────────────────────────────────────────────────────────
// AGENT NEURON (appears when dept is selected/exploded)
// ─────────────────────────────────────────────────────────────

function AgentNeuron({ agent, deptPos, index, total, color }) {
  const meshRef    = useRef()
  const labelRef   = useRef()
  const [hovered, setHovered] = useState(false)

  const angleBase = (index / total) * Math.PI * 2

  useFrame(({ clock }) => {
    const t     = clock.elapsedTime
    const angle = angleBase + t * 0.35
    const r     = 0.9 + 0.15 * Math.sin(t * 0.7 + index)
    const x     = deptPos.x + Math.cos(angle) * r
    const z     = deptPos.z + Math.sin(angle) * r
    const y     = deptPos.y + Math.sin(t * 1.1 + index * 1.3) * 0.22

    if (meshRef.current) {
      meshRef.current.position.set(x, y, z)
      // Pulse size
      const pulse = 1 + 0.18 * Math.sin(t * 3.5 + index * 2.1)
      meshRef.current.scale.setScalar(pulse)
    }
    if (labelRef.current) {
      labelRef.current.position.set(x, y + 0.25, z)
    }
  })

  const isActive = agent.status === 'active'

  return (
    <group>
      <mesh
        ref={meshRef}
        onPointerOver={(e) => { e.stopPropagation(); setHovered(true) }}
        onPointerOut={() => setHovered(false)}
      >
        <sphereGeometry args={[0.1, 10, 10]} />
        <meshBasicMaterial
          color={isActive ? color : '#003344'}
          transparent
          opacity={isActive ? 0.9 : 0.5}
        />
      </mesh>
      <Text
        ref={labelRef}
        fontSize={0.08}
        color={hovered ? '#00e5ff' : '#004466'}
        anchorX="center"
        anchorY="bottom"
      >
        {agent.name}
      </Text>
    </group>
  )
}

// ─────────────────────────────────────────────────────────────
// GRID FLOOR
// ─────────────────────────────────────────────────────────────

function NeuralFloor() {
  const ref = useRef()
  useFrame(({ clock }) => {
    if (ref.current) ref.current.material.opacity = 0.08 + Math.sin(clock.elapsedTime * 0.4) * 0.03
  })
  return (
    <group position={[0, -3.5, 0]}>
      <gridHelper ref={ref} args={[28, 56, '#00ccff', '#001a2e']} />
    </group>
  )
}

// ─────────────────────────────────────────────────────────────
// DEPT POSITION TRACKING
// ─────────────────────────────────────────────────────────────

function DeptPositionTracker({ deptId, orbitAngle, orbitRadius, orbitY, orbitSpeed, onPosition }) {
  useFrame(({ clock }) => {
    const t     = clock.elapsedTime
    const angle = orbitAngle + t * orbitSpeed
    onPosition(deptId, new THREE.Vector3(
      Math.cos(angle) * orbitRadius,
      orbitY,
      Math.sin(angle) * orbitRadius
    ))
  })
  return null
}

// ─────────────────────────────────────────────────────────────
// MAIN SCENE
// ─────────────────────────────────────────────────────────────

function NeuralBrainScene({ departments, selectedDept, onDeptSelect }) {
  const [deptPositions, setDeptPositions] = useState({})

  const updatePosition = useCallback((id, pos) => {
    setDeptPositions((prev) => ({ ...prev, [id]: pos }))
  }, [])

  const orbitConfig = useMemo(
    () =>
      departments.map((dept, i) => {
        const tier = Math.floor(i / 4)
        return {
          dept,
          orbitRadius: 2.6 + tier * 1.0,
          orbitY:      (i % 2 === 0 ? 0.8 : -0.8) * (1 + tier * 0.3),
          orbitAngle:  (i / departments.length) * Math.PI * 2,
          orbitSpeed:  (0.12 + i * 0.025) * (i % 2 === 0 ? 1 : -1),
        }
      }),
    [departments]
  )

  // Synapse connections: connect each dept to neighbors
  const synapses = useMemo(() => {
    const pairs = []
    for (let i = 0; i < departments.length; i++) {
      const j = (i + 1) % departments.length
      pairs.push({ fromId: departments[i].id, toId: departments[j].id, offset: i * 0.17 })
      if (i + 2 < departments.length) {
        pairs.push({ fromId: departments[i].id, toId: departments[i + 2].id, offset: i * 0.23 })
      }
    }
    return pairs
  }, [departments])

  const ORIGIN = useMemo(() => new THREE.Vector3(0, 0, 0), [])

  return (
    <>
      <color attach="background" args={['#000812']} />
      <fog attach="fog" args={['#000812', 14, 32]} />

      <ambientLight intensity={0.03} />
      <pointLight position={[0, 4, 0]}   color="#00e5ff" intensity={3}   distance={14} />
      <pointLight position={[0, -3, 0]}  color="#0033ff" intensity={1.5} distance={10} />
      <pointLight position={[4, 0, 4]}   color="#00aaff" intensity={0.8} distance={12} />
      <pointLight position={[-4, 0, -4]} color="#003399" intensity={0.6} distance={12} />

      <Stars radius={70} depth={15} count={3000} factor={2} saturation={0.4} fade speed={0.3} />

      <NeuralFloor />

      {/* Holographic brain */}
      <BrainMesh />

      {/* Neural activity sparkles */}
      <Sparkles count={80} scale={[3.5, 3.5, 3.5]} size={1.5} speed={0.5} color="#00e5ff" opacity={0.3} />

      {/* Position trackers (invisible, just compute positions) */}
      {orbitConfig.map((cfg) => (
        <DeptPositionTracker
          key={cfg.dept.id}
          deptId={cfg.dept.id}
          orbitAngle={cfg.orbitAngle}
          orbitRadius={cfg.orbitRadius}
          orbitY={cfg.orbitY}
          orbitSpeed={cfg.orbitSpeed}
          onPosition={updatePosition}
        />
      ))}

      {/* Synapse lines */}
      {synapses.map((syn, i) => {
        const from = deptPositions[syn.fromId] ?? ORIGIN
        const to   = deptPositions[syn.toId]   ?? ORIGIN
        const active =
          selectedDept?.id === syn.fromId || selectedDept?.id === syn.toId
        return (
          <SynapticLine key={i} from={from} to={to} active={active} pulseOffset={syn.offset} />
        )
      })}

      {/* Brain→dept lines */}
      {orbitConfig.map((cfg) => {
        const pos = deptPositions[cfg.dept.id]
        if (!pos) return null
        return (
          <Line
            key={`brain-${cfg.dept.id}`}
            points={[ORIGIN, pos]}
            color="#001a2e"
            lineWidth={0.4}
            transparent
            opacity={0.3}
          />
        )
      })}

      {/* Department nodes */}
      {orbitConfig.map((cfg) => (
        <DepartmentNode
          key={cfg.dept.id}
          dept={cfg.dept}
          orbitAngle={cfg.orbitAngle}
          orbitRadius={cfg.orbitRadius}
          orbitY={cfg.orbitY}
          orbitSpeed={cfg.orbitSpeed}
          isSelected={selectedDept?.id === cfg.dept.id}
          onSelect={onDeptSelect}
        />
      ))}

      {/* Exploded agents for selected department */}
      {selectedDept &&
        deptPositions[selectedDept.id] &&
        selectedDept.agents?.map((agent, i) => (
          <AgentNeuron
            key={agent.id ?? i}
            agent={agent}
            deptPos={deptPositions[selectedDept.id]}
            index={i}
            total={selectedDept.agents.length}
            color={selectedDept.color ?? '#00e5ff'}
          />
        ))}

      <OrbitControls
        enablePan={false}
        minDistance={4}
        maxDistance={18}
        autoRotate
        autoRotateSpeed={0.25}
        rotateSpeed={0.5}
      />

      <EffectComposer>
        <Bloom luminanceThreshold={0.06} luminanceSmoothing={0.85} intensity={2.0} radius={0.9} />
        <ChromaticAberration offset={[0.0006, 0.0006]} />
      </EffectComposer>
    </>
  )
}

// ─────────────────────────────────────────────────────────────
// 2D OVERLAY
// ─────────────────────────────────────────────────────────────

function DeptInfoPanel({ dept, onClose }) {
  return (
    <motion.div
      key={dept.id}
      initial={{ opacity: 0, x: -40, scale: 0.94 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: -40, scale: 0.94 }}
      transition={{ duration: 0.3 }}
      style={{
        position: 'absolute',
        top: '18%',
        left: '3%',
        background: 'rgba(0,10,20,0.93)',
        border: `1px solid ${dept.color ?? '#00e5ff'}`,
        borderRadius: 2,
        padding: '22px 24px',
        minWidth: 260,
        fontFamily: '"Space Mono", "Courier New", monospace',
        backdropFilter: 'blur(12px)',
        zIndex: 20,
        boxShadow: `0 0 40px ${dept.color ?? '#00e5ff'}22`,
      }}
    >
      <div style={{
        width: 8, height: 8, borderRadius: '50%',
        background: dept.color ?? '#00e5ff',
        display: 'inline-block', marginRight: 10,
        boxShadow: `0 0 12px ${dept.color ?? '#00e5ff'}`,
      }} />
      <span style={{ color: dept.color ?? '#00e5ff', fontSize: 13, fontWeight: 'bold', letterSpacing: 2 }}>
        {dept.name?.toUpperCase()}
      </span>

      <div style={{ width: '100%', height: 1, background: '#001a2e', margin: '14px 0' }} />

      <div style={{ color: '#0088aa', fontSize: 11, lineHeight: 1.8, marginBottom: 14 }}>
        {dept.description ?? 'Neural processing cluster. Specialized AI agents coordinating in real-time.'}
      </div>

      <div style={{ fontSize: 10, color: '#004466', letterSpacing: 2, marginBottom: 10 }}>
        ACTIVE NEURONS — {dept.agents?.filter(a => a.status === 'active').length ?? 0} / {dept.agents?.length ?? 0}
      </div>

      {/* Agent list */}
      <div style={{ maxHeight: 180, overflowY: 'auto', marginBottom: 14 }}>
        {dept.agents?.map((agent, i) => (
          <div key={agent.id ?? i} style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '5px 0',
            borderBottom: '1px solid #001122',
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: agent.status === 'active' ? '#00e5ff' : '#003344',
              flexShrink: 0,
              boxShadow: agent.status === 'active' ? '0 0 8px #00e5ff' : 'none',
            }} />
            <span style={{ color: '#0077aa', fontSize: 10, letterSpacing: 1 }}>
              {agent.name}
            </span>
            <span style={{
              marginLeft: 'auto',
              fontSize: 9,
              color: agent.status === 'active' ? '#00e5ff' : '#003344',
            }}>
              {(agent.status ?? 'idle').toUpperCase()}
            </span>
          </div>
        ))}
      </div>

      <button
        onClick={onClose}
        style={{
          background: 'transparent',
          border: `1px solid ${dept.color ?? '#003344'}`,
          color: dept.color ?? '#00e5ff',
          padding: '5px 14px',
          cursor: 'pointer',
          fontFamily: 'inherit',
          fontSize: 10,
          letterSpacing: 2,
          width: '100%',
        }}
      >
        [ COLLAPSE CLUSTER ]
      </button>
    </motion.div>
  )
}

function NeuralHUD() {
  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        style={{
          position: 'absolute', top: 0, left: 0, right: 0,
          padding: '16px 28px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid #001a2e',
          background: 'linear-gradient(180deg, rgba(0,8,18,0.95) 0%, transparent 100%)',
          fontFamily: '"Space Mono", "Courier New", monospace',
          fontSize: 11,
          letterSpacing: 3,
          color: '#00e5ff',
          pointerEvents: 'none',
          zIndex: 10,
        }}
      >
        <span>NEUROFORGE // NEURAL CLUSTER MAP</span>
        <motion.span
          animate={{ opacity: [1, 0.3, 1] }}
          transition={{ duration: 2, repeat: Infinity }}
          style={{ color: '#004466', fontSize: 10 }}
        >
          ◉ SYNAPTIC NETWORK ACTIVE
        </motion.span>
        <span style={{ color: '#003344' }}>CLICK DEPARTMENT NODE TO EXPAND</span>
      </motion.div>

      {/* Bottom legend */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          padding: '12px 28px',
          display: 'flex',
          gap: 28,
          alignItems: 'center',
          borderTop: '1px solid #001a2e',
          background: 'linear-gradient(0deg, rgba(0,8,18,0.95) 0%, transparent 100%)',
          fontFamily: '"Space Mono", "Courier New", monospace',
          fontSize: 10,
          color: '#003344',
          letterSpacing: 2,
          pointerEvents: 'none',
          zIndex: 10,
        }}
      >
        <span>● ACTIVE NEURON</span>
        <span style={{ color: '#001a2e' }}>● IDLE NEURON</span>
        <span style={{ color: '#002244' }}>━ SYNAPTIC LINK</span>
        <span style={{ marginLeft: 'auto', color: '#002244' }}>SCROLL TO ZOOM  •  DRAG TO ROTATE</span>
      </motion.div>
    </>
  )
}

// ─────────────────────────────────────────────────────────────
// SAMPLE DATA
// ─────────────────────────────────────────────────────────────

const SAMPLE_DEPARTMENTS = [
  {
    id: 'd1', name: 'Research Core',    color: '#00e5ff',
    description: 'Advanced AI research and model development cluster.',
    agents: [
      { id: 'a1', name: 'ARIA',   status: 'active' },
      { id: 'a2', name: 'NEXUS',  status: 'active' },
      { id: 'a3', name: 'HELIOS', status: 'idle'   },
    ],
  },
  {
    id: 'd2', name: 'Data Mining',      color: '#0088ff',
    description: 'Autonomous data extraction and pattern recognition.',
    agents: [
      { id: 'a4', name: 'VECTOR', status: 'active' },
      { id: 'a5', name: 'SIGMA',  status: 'active' },
    ],
  },
  {
    id: 'd3', name: 'Neural Synthesis', color: '#00ffaa',
    description: 'Cross-domain knowledge synthesis and integration.',
    agents: [
      { id: 'a6', name: 'LYRA',   status: 'active' },
      { id: 'a7', name: 'ORION',  status: 'active' },
      { id: 'a8', name: 'PULSE',  status: 'idle'   },
      { id: 'a9', name: 'ECHO',   status: 'active' },
    ],
  },
  {
    id: 'd4', name: 'Deployment',       color: '#ff6600',
    description: 'Production infrastructure and agent orchestration.',
    agents: [
      { id: 'a10', name: 'TITAN',  status: 'active' },
      { id: 'a11', name: 'ATLAS',  status: 'idle'   },
    ],
  },
  {
    id: 'd5', name: 'Security',         color: '#aa00ff',
    description: 'Threat detection, audit, and compliance enforcement.',
    agents: [
      { id: 'a12', name: 'SHIELD', status: 'active' },
      { id: 'a13', name: 'CIPHER', status: 'active' },
    ],
  },
  {
    id: 'd6', name: 'Analytics',        color: '#ffcc00',
    description: 'Real-time metrics, dashboards, and predictive analytics.',
    agents: [
      { id: 'a14', name: 'PRISM',  status: 'active' },
      { id: 'a15', name: 'LENS',   status: 'idle'   },
      { id: 'a16', name: 'QUANT',  status: 'active' },
    ],
  },
]

// ─────────────────────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────────────────────

export default function NeuralBrainVisualization({ departments = SAMPLE_DEPARTMENTS }) {
  const [selectedDept, setSelectedDept] = useState(null)

  const handleDeptSelect = useCallback((dept) => {
    setSelectedDept((prev) => (prev?.id === dept.id ? null : dept))
  }, [])

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#000812' }}>
      <Canvas
        camera={{ position: [0, 3, 9], fov: 50 }}
        gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
        dpr={[1, 2]}
      >
        <NeuralBrainScene
          departments={departments}
          selectedDept={selectedDept}
          onDeptSelect={handleDeptSelect}
        />
      </Canvas>

      <NeuralHUD />

      <AnimatePresence>
        {selectedDept && (
          <DeptInfoPanel
            dept={selectedDept}
            onClose={() => setSelectedDept(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
