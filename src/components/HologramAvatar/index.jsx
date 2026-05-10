import React, { useRef, useState, useMemo, Suspense, useEffect, useCallback } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Text, Stars, useTexture, Sparkles, Billboard } from '@react-three/drei'
import { EffectComposer, Bloom, ChromaticAberration } from '@react-three/postprocessing'
import * as THREE from 'three'
import { motion, AnimatePresence } from 'framer-motion'

// ─────────────────────────────────────────────────────────────
// GLSL SHADERS
// ─────────────────────────────────────────────────────────────

const AVATAR_VERT = /* glsl */`
  varying vec2 vUv;
  varying vec3 vPosition;
  void main() {
    vUv = uv;
    vPosition = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const AVATAR_FRAG = /* glsl */`
  uniform sampler2D map;
  uniform float time;
  uniform float opacity;
  uniform vec3 glowColor;

  varying vec2 vUv;
  varying vec3 vPosition;

  float rand(vec2 co) {
    return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
  }

  void main() {
    // Occasional glitch horizontal shift
    float glitchSeed  = floor(time * 8.0);
    float glitchStrength = step(0.92, rand(vec2(glitchSeed, 0.3)));
    float glitchBand  = step(rand(vec2(glitchSeed, 0.7)), vUv.y) *
                        step(vUv.y, rand(vec2(glitchSeed, 0.5)) + 0.12);
    vec2 uv = vUv + vec2(glitchStrength * glitchBand * (rand(vec2(glitchSeed)) - 0.5) * 0.06, 0.0);

    vec4 tex = texture2D(map, clamp(uv, 0.0, 1.0));
    if (tex.a < 0.04) discard;

    // Scrolling scanlines
    float scan = sin(vUv.y * 350.0 - time * 4.0) * 0.5 + 0.5;
    scan = pow(scan, 10.0) * 0.18;

    // Fine noise scanlines
    float fineScan = sin(vUv.y * 1400.0 + time * 12.0) * 0.012;

    // Irregular flicker
    float flicker = 1.0 - 0.07 * sin(time * 19.3) * sin(time * 7.1 + 2.0);

    // Holographic cyan tint
    vec3 tinted = mix(tex.rgb, glowColor, 0.28) + glowColor * scan;

    // Edge glow
    float edge = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
    float edgeGlow = (1.0 - smoothstep(0.0, 0.12, edge)) * 0.9;

    vec3 finalColor = tinted + edgeGlow * glowColor * 0.6 + fineScan;
    float finalAlpha = tex.a * opacity * flicker;

    gl_FragColor = vec4(finalColor, finalAlpha);
  }
`

const BEAM_VERT = /* glsl */`
  varying vec2 vUv;
  varying float vHeight;
  void main() {
    vUv = uv;
    vHeight = (position.y + 1.0) * 0.5; // normalize 0-1
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const BEAM_FRAG = /* glsl */`
  uniform float time;
  uniform vec3 color;
  uniform float opacity;
  varying vec2 vUv;
  varying float vHeight;

  void main() {
    vec2 centered = vUv - 0.5;
    float radial = length(centered) * 2.0;

    // Cone narrows upward
    float coneEdge = 1.0 - vHeight;
    float insideCone = 1.0 - smoothstep(coneEdge * 0.8, coneEdge, radial);

    // Scrolling scan bands inside beam
    float scan = sin(vHeight * 60.0 - time * 5.0) * 0.5 + 0.5;
    scan = pow(scan, 5.0) * 0.35;

    // Core brightness
    float core = (1.0 - radial) * (1.0 - vHeight * 0.5);
    core = max(core, 0.0);

    float pulsation = 0.8 + 0.2 * sin(time * 2.5);
    float alpha = (core * 0.5 + scan * insideCone) * opacity * pulsation;

    gl_FragColor = vec4(color, alpha);
  }
`

const PARTICLE_VERT = /* glsl */`
  attribute float aSize;
  attribute float aLife;
  attribute vec3  aVelocity;
  uniform float time;
  varying float vAlpha;

  void main() {
    float t = fract(time * 0.4 + aLife);
    vec3 pos = position + aVelocity * t * 2.5;
    pos.y += t * 1.8;

    vAlpha = (1.0 - t) * (1.0 - t);

    vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = aSize * (250.0 / -mvPos.z);
    gl_Position  = projectionMatrix * mvPos;
  }
`

const PARTICLE_FRAG = /* glsl */`
  uniform vec3 color;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    float alpha = (1.0 - d) * vAlpha;
    gl_FragColor = vec4(color, alpha);
  }
`

// ─────────────────────────────────────────────────────────────
// 3D SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────

function GridFloor() {
  const gridRef = useRef()

  useFrame(({ clock }) => {
    if (gridRef.current) {
      gridRef.current.material.opacity = 0.12 + Math.sin(clock.elapsedTime * 0.6) * 0.04
    }
  })

  return (
    <group position={[0, -2.2, 0]}>
      <gridHelper ref={gridRef} args={[24, 48, '#00ccff', '#002233']} />
      {[1.0, 2.2, 3.6, 5.2].map((r, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[r - 0.015, r, 80]} />
          <meshBasicMaterial
            color="#00e5ff"
            transparent
            opacity={0.12 / (i + 1)}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
    </group>
  )
}

function ProjectionBeam() {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: BEAM_VERT,
        fragmentShader: BEAM_FRAG,
        uniforms: {
          time:    { value: 0 },
          color:   { value: new THREE.Color('#00e5ff') },
          opacity: { value: 0.22 },
        },
        transparent:  true,
        side:         THREE.DoubleSide,
        depthWrite:   false,
        blending:     THREE.AdditiveBlending,
      }),
    []
  )

  useFrame(({ clock }) => {
    mat.uniforms.time.value = clock.elapsedTime
  })

  return (
    <group position={[0, -2.2, 0]}>
      {/* outer cone */}
      <mesh material={mat} position={[0, 2, 0]}>
        <coneGeometry args={[1.4, 4, 48, 1, true]} />
      </mesh>
      {/* inner brighter cone */}
      <mesh material={mat} position={[0, 2, 0]}>
        <coneGeometry args={[0.45, 4, 24, 1, true]} />
      </mesh>
      {/* base glow disc */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[1.4, 48]} />
        <meshBasicMaterial
          color="#00e5ff"
          transparent
          opacity={0.18}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  )
}

// Handles texture loading (must be inside Suspense)
function AvatarTexturePlane({ url, opacity }) {
  const meshRef = useRef()
  const texture  = useTexture(url)

  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader:   AVATAR_VERT,
        fragmentShader: AVATAR_FRAG,
        uniforms: {
          map:       { value: texture },
          time:      { value: 0 },
          opacity:   { value: opacity },
          glowColor: { value: new THREE.Color('#00e5ff') },
        },
        transparent: true,
        side:        THREE.DoubleSide,
        depthWrite:  false,
      }),
    [texture]
  )

  useFrame(({ clock }) => {
    mat.uniforms.time.value    = clock.elapsedTime
    mat.uniforms.opacity.value = opacity
  })

  return (
    <mesh ref={meshRef} material={mat}>
      <planeGeometry args={[2.2, 2.8, 1, 1]} />
    </mesh>
  )
}

function AvatarFallback({ opacity }) {
  const mat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: '#003344',
        transparent: true,
        opacity: opacity * 0.6,
        side: THREE.DoubleSide,
      }),
    []
  )
  useFrame(() => {
    mat.opacity = opacity * 0.6
  })
  return (
    <mesh material={mat}>
      <planeGeometry args={[2.2, 2.8]} />
    </mesh>
  )
}

function AvatarHologram({ url, opacity }) {
  return (
    <Suspense fallback={<AvatarFallback opacity={opacity} />}>
      <AvatarTexturePlane url={url} opacity={opacity} />
    </Suspense>
  )
}

function ParticleDust({ count = 220 }) {
  const [positions, sizes, lifetimes, velocities] = useMemo(() => {
    const pos = new Float32Array(count * 3)
    const sz  = new Float32Array(count)
    const lf  = new Float32Array(count)
    const vel = new Float32Array(count * 3)

    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2
      const r     = Math.random() * 1.1
      pos[i * 3]     = Math.cos(angle) * r
      pos[i * 3 + 1] = (Math.random() - 0.4) * 2.8
      pos[i * 3 + 2] = (Math.random() - 0.5) * 0.3

      sz[i] = Math.random() * 5 + 2
      lf[i] = Math.random()

      vel[i * 3]     = (Math.random() - 0.5) * 0.6
      vel[i * 3 + 1] = Math.random() * 0.25 + 0.05
      vel[i * 3 + 2] = (Math.random() - 0.5) * 0.25
    }
    return [pos, sz, lf, vel]
  }, [count])

  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader:   PARTICLE_VERT,
        fragmentShader: PARTICLE_FRAG,
        uniforms: {
          time:  { value: 0 },
          color: { value: new THREE.Color('#00e5ff') },
        },
        transparent:  true,
        blending:     THREE.AdditiveBlending,
        depthWrite:   false,
      }),
    []
  )

  useFrame(({ clock }) => {
    mat.uniforms.time.value = clock.elapsedTime
  })

  return (
    <points material={mat}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position"  array={positions}  count={count} itemSize={3} />
        <bufferAttribute attach="attributes-aSize"     array={sizes}      count={count} itemSize={1} />
        <bufferAttribute attach="attributes-aLife"     array={lifetimes}  count={count} itemSize={1} />
        <bufferAttribute attach="attributes-aVelocity" array={velocities} count={count} itemSize={3} />
      </bufferGeometry>
    </points>
  )
}

function OrbitRing({ radius, tilt = 0, color = '#00ffff', opacity = 0.15 }) {
  return (
    <mesh rotation={[tilt, 0, 0]}>
      <ringGeometry args={[radius - 0.012, radius + 0.012, 72]} />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={opacity}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  )
}

function SkillTag({ skill, orbitRadius, orbitSpeed, orbitY, startAngle, isSelected, onSelect }) {
  const groupRef = useRef()
  const [hovered, setHovered] = useState(false)

  useFrame(({ clock }) => {
    if (!groupRef.current) return
    const t     = clock.elapsedTime
    const angle = startAngle + t * orbitSpeed
    groupRef.current.position.set(
      Math.cos(angle) * orbitRadius,
      orbitY + Math.sin(t * 0.8 + startAngle) * 0.12,
      Math.sin(angle) * orbitRadius
    )
    // Face camera (billboard around Y)
    groupRef.current.rotation.y = -(angle - Math.PI / 2)
  })

  const scale = isSelected ? 1.55 : hovered ? 1.2 : 1.0

  return (
    <group
      ref={groupRef}
      scale={[scale, scale, scale]}
      onClick={(e) => { e.stopPropagation(); onSelect(skill) }}
      onPointerOver={(e) => { e.stopPropagation(); setHovered(true) }}
      onPointerOut={() => setHovered(false)}
    >
      {/* Panel background */}
      <mesh position={[0, 0, -0.01]}>
        <planeGeometry args={[1.4, 0.42]} />
        <meshBasicMaterial
          color={isSelected ? '#00e5ff' : '#001a2e'}
          transparent
          opacity={0.82}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Panel border using line loop */}
      <lineLoop>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            array={new Float32Array([-0.7,-0.21,0,  0.7,-0.21,0,  0.7,0.21,0,  -0.7,0.21,0])}
            count={4}
            itemSize={3}
          />
        </bufferGeometry>
        <lineBasicMaterial color={hovered ? '#00ffff' : '#0077aa'} transparent opacity={0.9} />
      </lineLoop>

      {/* Corner accents */}
      {[[-0.7,-0.21],[0.7,-0.21],[0.7,0.21],[-0.7,0.21]].map(([x,y], i) => (
        <mesh key={i} position={[x, y, 0]}>
          <planeGeometry args={[0.06, 0.06]} />
          <meshBasicMaterial color="#00ffff" transparent opacity={0.9} side={THREE.DoubleSide} />
        </mesh>
      ))}

      <Text
        fontSize={0.13}
        color={isSelected ? '#001122' : '#00e5ff'}
        anchorX="center"
        anchorY="middle"
        maxWidth={1.2}
        overflowWrap="break-word"
      >
        {skill.name}
      </Text>

      {/* Level bar */}
      {skill.level && (
        <mesh position={[0, -0.17, 0.005]}>
          <planeGeometry args={[skill.level / 100 * 1.1, 0.025]} />
          <meshBasicMaterial
            color={isSelected ? '#001122' : '#00e5ff'}
            transparent
            opacity={0.7}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      )}

      {/* Soft halo */}
      <mesh position={[0, 0, -0.04]}>
        <planeGeometry args={[2.0, 0.9]} />
        <meshBasicMaterial
          color="#00e5ff"
          transparent
          opacity={hovered ? 0.07 : 0.025}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  )
}

function AgentLabel({ name, role }) {
  return (
    <>
      <Text position={[0, -1.65, 0.01]} fontSize={0.17} color="#00e5ff" anchorX="center" anchorY="middle">
        {name?.toUpperCase() ?? 'AGENT'}
      </Text>
      <Text position={[0, -1.92, 0.01]} fontSize={0.095} color="#005577" anchorX="center" anchorY="middle">
        {role?.toUpperCase() ?? 'AI AGENT'}
      </Text>
    </>
  )
}

// ─────────────────────────────────────────────────────────────
// MAIN SCENE
// ─────────────────────────────────────────────────────────────

const RING_CONFIG = [
  { radius: 1.9, tilt: 0,             speed: 0.08 },
  { radius: 2.5, tilt: Math.PI / 6,   speed: -0.05 },
  { radius: 3.1, tilt: -Math.PI / 5,  speed: 0.06 },
  { radius: 3.7, tilt: Math.PI / 4,   speed: -0.04 },
]

function HologramScene({ agent, onSkillSelect, selectedSkillId }) {
  const skills = agent.skills ?? []

  const orbitConfig = useMemo(
    () =>
      skills.map((skill, i) => ({
        skill,
        orbitRadius: 1.8 + (i % 3) * 0.75,
        orbitSpeed:  0.22 + i * 0.06,
        orbitY:      ((i % 2 === 0 ? 0.55 : -0.4) + (i * 0.08)),
        startAngle:  (i / Math.max(skills.length, 1)) * Math.PI * 2,
      })),
    [skills]
  )

  return (
    <>
      <color attach="background" args={['#000810']} />
      <fog attach="fog" args={['#000810', 12, 28]} />

      <ambientLight intensity={0.04} />
      <pointLight position={[0, 5, 0]}   color="#00e5ff" intensity={2.5} distance={12} />
      <pointLight position={[0, -2, 0]}  color="#0033ff" intensity={1.2} distance={8}  />
      <pointLight position={[-3, 0, 3]}  color="#00aaff" intensity={0.6} distance={10} />

      <Stars radius={60} depth={12} count={2500} factor={2} saturation={0.5} fade speed={0.4} />

      <GridFloor />
      <ProjectionBeam />

      {/* Avatar */}
      <AvatarHologram url={agent.avatarUrl ?? '/avatars/default.png'} opacity={0.88} />

      {/* Particles */}
      <ParticleDust count={200} />

      {/* Ambient sparkles */}
      <Sparkles
        count={60}
        scale={[5, 5, 5]}
        size={1.2}
        speed={0.3}
        color="#00e5ff"
        opacity={0.4}
      />

      {/* Orbit rings */}
      {RING_CONFIG.map((r, i) => (
        <OrbitRing key={i} radius={r.radius} tilt={r.tilt} opacity={0.12 + i * 0.02} />
      ))}

      {/* Skill tags */}
      {orbitConfig.map((cfg, i) => (
        <SkillTag
          key={cfg.skill.id ?? i}
          {...cfg}
          isSelected={selectedSkillId === (cfg.skill.id ?? i)}
          onSelect={onSkillSelect}
        />
      ))}

      <AgentLabel name={agent.name} role={agent.role} />

      <OrbitControls
        enableZoom={false}
        enablePan={false}
        minPolarAngle={Math.PI / 4}
        maxPolarAngle={Math.PI / 1.6}
        rotateSpeed={0.45}
        autoRotate
        autoRotateSpeed={0.4}
      />

      <EffectComposer>
        <Bloom luminanceThreshold={0.08} luminanceSmoothing={0.9} intensity={1.8} radius={0.85} />
        <ChromaticAberration offset={[0.0008, 0.0008]} />
      </EffectComposer>
    </>
  )
}

// ─────────────────────────────────────────────────────────────
// 2D OVERLAY UI
// ─────────────────────────────────────────────────────────────

const HUD_STYLE = {
  position: 'absolute',
  fontFamily: '"Space Mono", "Courier New", monospace',
  color: '#00e5ff',
  pointerEvents: 'none',
}

function HologramHUD({ agent, onClose }) {
  return (
    <>
      {/* Top bar */}
      <motion.div
        initial={{ opacity: 0, y: -24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        style={{
          ...HUD_STYLE,
          top: 0, left: 0, right: 0,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '16px 28px',
          borderBottom: '1px solid #001a2e',
          background: 'linear-gradient(180deg, rgba(0,8,16,0.95) 0%, transparent 100%)',
          pointerEvents: 'auto',
          zIndex: 10,
        }}
      >
        <div style={{ fontSize: 11, letterSpacing: 4, opacity: 0.9 }}>
          NEUROFORGE // HOLOGRAPHIC AGENT INTERFACE
        </div>
        <div style={{ fontSize: 10, color: '#004466', letterSpacing: 2 }}>
          AGENT_ID: {agent?.id ?? 'NF-0001'}
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'transparent',
            border: '1px solid #003344',
            color: '#00e5ff',
            padding: '6px 18px',
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontSize: 11,
            letterSpacing: 2,
            transition: 'all 0.2s',
          }}
          onMouseEnter={(e) => (e.target.style.borderColor = '#00e5ff')}
          onMouseLeave={(e) => (e.target.style.borderColor = '#003344')}
        >
          [ CLOSE ]
        </button>
      </motion.div>

      {/* Bottom status */}
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.3 }}
        style={{
          ...HUD_STYLE,
          bottom: 0, left: 0, right: 0,
          display: 'flex',
          justifyContent: 'space-between',
          padding: '14px 28px',
          borderTop: '1px solid #001a2e',
          background: 'linear-gradient(0deg, rgba(0,8,16,0.95) 0%, transparent 100%)',
          fontSize: 10,
          letterSpacing: 2,
        }}
      >
        <span style={{ color: '#003344' }}>◉ HOLOGRAM ACTIVE</span>
        <span style={{ color: '#003344' }}>DRAG TO ROTATE  •  CLICK SKILLS TO INSPECT</span>
        <PulsingDot />
      </motion.div>

      {/* Corner brackets */}
      {[
        { top: 60, left: 12 },
        { top: 60, right: 12 },
        { bottom: 48, left: 12 },
        { bottom: 48, right: 12 },
      ].map((pos, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            width: 18, height: 18,
            borderTop:    pos.top    !== undefined ? '1px solid #00e5ff' : 'none',
            borderBottom: pos.bottom !== undefined ? '1px solid #00e5ff' : 'none',
            borderLeft:   pos.left   !== undefined ? '1px solid #00e5ff' : 'none',
            borderRight:  pos.right  !== undefined ? '1px solid #00e5ff' : 'none',
            opacity: 0.45,
            ...pos,
          }}
        />
      ))}
    </>
  )
}

function PulsingDot() {
  return (
    <motion.span
      animate={{ opacity: [1, 0.2, 1] }}
      transition={{ duration: 1.4, repeat: Infinity }}
      style={{ color: '#00e5ff', fontSize: 14 }}
    >
      ●
    </motion.span>
  )
}

function SkillDetailPanel({ skill, onClose }) {
  return (
    <motion.div
      key={skill.id}
      initial={{ opacity: 0, x: 40, scale: 0.94 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 40, scale: 0.94 }}
      transition={{ duration: 0.3 }}
      style={{
        position: 'absolute',
        top: '18%', right: '3%',
        background: 'rgba(0,10,20,0.93)',
        border: '1px solid #00e5ff',
        borderRadius: 2,
        padding: '22px 24px',
        minWidth: 240,
        fontFamily: '"Space Mono", "Courier New", monospace',
        backdropFilter: 'blur(12px)',
        zIndex: 20,
        boxShadow: '0 0 40px rgba(0,229,255,0.12)',
      }}
    >
      {/* Header */}
      <div style={{ color: '#00e5ff', fontSize: 13, fontWeight: 'bold', letterSpacing: 2, marginBottom: 6 }}>
        ◈ {skill.name?.toUpperCase()}
      </div>
      <div style={{ width: '100%', height: 1, background: '#001a2e', marginBottom: 14 }} />

      <div style={{ color: '#0088aa', fontSize: 11, lineHeight: 1.7, marginBottom: 14 }}>
        {skill.description ?? 'Advanced AI capability module. Integrated neural processing unit.'}
      </div>

      {skill.level != null && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ color: '#004455', fontSize: 10, letterSpacing: 2, marginBottom: 6 }}>
            PROFICIENCY LEVEL — {skill.level}%
          </div>
          <div style={{ height: 3, background: '#001122', borderRadius: 2, overflow: 'hidden' }}>
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${skill.level}%` }}
              transition={{ duration: 1.2, ease: 'easeOut', delay: 0.1 }}
              style={{ height: '100%', background: 'linear-gradient(90deg, #0044ff, #00ffff)' }}
            />
          </div>
        </div>
      )}

      {skill.tags && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
          {skill.tags.map((tag, i) => (
            <span key={i} style={{
              fontSize: 10, color: '#00e5ff', border: '1px solid #003344',
              padding: '2px 8px', letterSpacing: 1,
            }}>
              {tag}
            </span>
          ))}
        </div>
      )}

      <button
        onClick={onClose}
        style={{
          background: 'transparent',
          border: '1px solid #003344',
          color: '#00e5ff',
          padding: '5px 14px',
          cursor: 'pointer',
          fontFamily: 'inherit',
          fontSize: 10,
          letterSpacing: 2,
          width: '100%',
        }}
      >
        [ CLOSE DATAFILE ]
      </button>
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────────
// DEFAULT SAMPLE DATA
// ─────────────────────────────────────────────────────────────

const SAMPLE_AGENT = {
  id: 'NF-0042',
  name: 'NEXUS',
  role: 'Senior AI Architect',
  avatarUrl: '/avatars/nexus.png',
  skills: [
    { id: 's1', name: 'Machine Learning',  level: 95, description: 'Deep neural network design & training.', tags: ['PyTorch', 'TensorFlow'] },
    { id: 's2', name: 'NLP Processing',    level: 88, description: 'Advanced language model fine-tuning.', tags: ['LLMs', 'RAG'] },
    { id: 's3', name: 'Computer Vision',   level: 82, description: 'Real-time image analysis pipelines.', tags: ['YOLO', 'SAM'] },
    { id: 's4', name: 'Data Engineering',  level: 79, description: 'Distributed processing at scale.', tags: ['Spark', 'Kafka'] },
    { id: 's5', name: 'API Design',        level: 91, description: 'RESTful & GraphQL architecture.', tags: ['FastAPI'] },
    { id: 's6', name: 'Cloud Deploy',      level: 85, description: 'Kubernetes orchestration.', tags: ['AWS', 'GCP'] },
  ],
}

// ─────────────────────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────────────────────

export default function HologramAvatar({ agent = SAMPLE_AGENT, onClose = () => {} }) {
  const [selectedSkill, setSelectedSkill] = useState(null)

  const handleSkillSelect = useCallback((skill) => {
    setSelectedSkill((prev) => (prev?.id === skill.id ? null : skill))
  }, [])

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: '#000810' }}>
      <Canvas
        camera={{ position: [0, 1, 5.5], fov: 44 }}
        gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
        dpr={[1, 2]}
      >
        <HologramScene
          agent={agent}
          onSkillSelect={handleSkillSelect}
          selectedSkillId={selectedSkill?.id}
        />
      </Canvas>

      <HologramHUD agent={agent} onClose={onClose} />

      <AnimatePresence>
        {selectedSkill && (
          <SkillDetailPanel
            skill={selectedSkill}
            onClose={() => setSelectedSkill(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
