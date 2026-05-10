/**
 * NeuroForge — App Integration
 *
 * Requires (install once):
 *   npm install three @react-three/fiber @react-three/drei @react-three/postprocessing framer-motion
 *
 * Place avatar PNGs at:
 *   public/avatars/[agent_id].png
 */

import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import HologramAvatar from './components/HologramAvatar'
import NeuralBrainVisualization from './components/NeuralBrain'

// ─────────────────────────────────────────────────────────────
// SAMPLE DATA  (replace with real API data)
// ─────────────────────────────────────────────────────────────

const AGENTS = [
  {
    id: 'NF-0042',
    name: 'NEXUS',
    role: 'Senior AI Architect',
    avatarUrl: '/avatars/NF-0042.png',
    skills: [
      { id: 's1', name: 'Machine Learning',  level: 95, description: 'Deep neural network design & training.',          tags: ['PyTorch', 'TensorFlow'] },
      { id: 's2', name: 'NLP Processing',    level: 88, description: 'Advanced language model fine-tuning.',            tags: ['LLMs', 'RAG'] },
      { id: 's3', name: 'Computer Vision',   level: 82, description: 'Real-time image analysis pipelines.',             tags: ['YOLO', 'SAM'] },
      { id: 's4', name: 'Data Engineering',  level: 79, description: 'Distributed processing at petabyte scale.',       tags: ['Spark', 'Kafka'] },
      { id: 's5', name: 'API Design',        level: 91, description: 'RESTful & GraphQL architecture.',                 tags: ['FastAPI', 'gRPC'] },
      { id: 's6', name: 'Cloud Deploy',      level: 85, description: 'Kubernetes orchestration across multi-cloud.',    tags: ['AWS', 'GCP'] },
    ],
  },
  {
    id: 'NF-0017',
    name: 'ARIA',
    role: 'Research Lead',
    avatarUrl: '/avatars/NF-0017.png',
    skills: [
      { id: 's1', name: 'Quantum ML',       level: 72, description: 'Quantum computing applied to AI.', tags: ['Qiskit'] },
      { id: 's2', name: 'Reinforcement RL', level: 90, description: 'Multi-agent RL environments.',     tags: ['PPO', 'SAC'] },
      { id: 's3', name: 'Bio-Computing',    level: 65, description: 'Neural-biological interface.',     tags: ['BCI'] },
    ],
  },
]

const DEPARTMENTS = [
  {
    id: 'd1', name: 'Research Core',    color: '#00e5ff',
    description: 'Advanced AI research and model development cluster.',
    agents: [
      { id: 'NF-0042', name: 'NEXUS',  status: 'active' },
      { id: 'NF-0017', name: 'ARIA',   status: 'active' },
      { id: 'NF-0031', name: 'HELIOS', status: 'idle'   },
    ],
  },
  {
    id: 'd2', name: 'Data Mining',      color: '#0088ff',
    description: 'Autonomous data extraction and pattern recognition.',
    agents: [
      { id: 'NF-0055', name: 'VECTOR', status: 'active' },
      { id: 'NF-0061', name: 'SIGMA',  status: 'active' },
    ],
  },
  {
    id: 'd3', name: 'Neural Synthesis', color: '#00ffaa',
    description: 'Cross-domain knowledge synthesis and integration.',
    agents: [
      { id: 'NF-0072', name: 'LYRA',  status: 'active' },
      { id: 'NF-0081', name: 'ORION', status: 'active' },
      { id: 'NF-0089', name: 'PULSE', status: 'idle'   },
    ],
  },
  {
    id: 'd4', name: 'Deployment',       color: '#ff6600',
    description: 'Production infrastructure and agent orchestration.',
    agents: [
      { id: 'NF-0092', name: 'TITAN', status: 'active' },
      { id: 'NF-0097', name: 'ATLAS', status: 'idle'   },
    ],
  },
  {
    id: 'd5', name: 'Security',         color: '#aa00ff',
    description: 'Threat detection, audit, and compliance enforcement.',
    agents: [
      { id: 'NF-0103', name: 'SHIELD', status: 'active' },
      { id: 'NF-0108', name: 'CIPHER', status: 'active' },
    ],
  },
  {
    id: 'd6', name: 'Analytics',        color: '#ffcc00',
    description: 'Real-time metrics, dashboards, and predictive analytics.',
    agents: [
      { id: 'NF-0115', name: 'PRISM', status: 'active' },
      { id: 'NF-0121', name: 'LENS',  status: 'idle'   },
    ],
  },
]

// ─────────────────────────────────────────────────────────────
// AGENT CARD (click → opens hologram)
// ─────────────────────────────────────────────────────────────

function AgentCard({ agent, onOpen }) {
  return (
    <motion.div
      whileHover={{ scale: 1.04, borderColor: '#00e5ff' }}
      whileTap={{ scale: 0.97 }}
      onClick={() => onOpen(agent)}
      style={{
        border: '1px solid #002233',
        background: 'rgba(0,20,40,0.85)',
        borderRadius: 4,
        padding: '20px',
        cursor: 'pointer',
        fontFamily: '"Space Mono", "Courier New", monospace',
        transition: 'border-color 0.2s',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Scan line animation */}
      <motion.div
        animate={{ y: ['-100%', '200%'] }}
        transition={{ duration: 2.5, repeat: Infinity, ease: 'linear', repeatDelay: 3 }}
        style={{
          position: 'absolute', left: 0, right: 0, height: 2,
          background: 'linear-gradient(0deg, transparent, #00e5ff44, transparent)',
          pointerEvents: 'none',
        }}
      />

      {/* Avatar placeholder */}
      <div style={{
        width: 64, height: 64, borderRadius: 2,
        background: 'linear-gradient(135deg, #001a2e, #003355)',
        border: '1px solid #003344',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: 14, fontSize: 20, color: '#00e5ff',
      }}>
        ◈
      </div>

      <div style={{ color: '#00e5ff', fontSize: 13, fontWeight: 'bold', letterSpacing: 2, marginBottom: 4 }}>
        {agent.name}
      </div>
      <div style={{ color: '#005577', fontSize: 10, letterSpacing: 1, marginBottom: 12 }}>
        {agent.role}
      </div>
      <div style={{ fontSize: 10, color: '#003344', letterSpacing: 1 }}>
        {agent.skills?.length ?? 0} CAPABILITIES  •  ID: {agent.id}
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        whileHover={{ opacity: 1 }}
        style={{
          position: 'absolute', bottom: 10, right: 14,
          fontSize: 10, color: '#00e5ff', letterSpacing: 2,
        }}
      >
        [ OPEN HOLOGRAM ] ▶
      </motion.div>
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────────
// VIEWS
// ─────────────────────────────────────────────────────────────

function AgentListView({ onOpenHologram }) {
  return (
    <div style={{
      padding: '80px 40px 40px',
      fontFamily: '"Space Mono", "Courier New", monospace',
    }}>
      <motion.h2
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        style={{ color: '#00e5ff', fontSize: 14, letterSpacing: 4, marginBottom: 8 }}
      >
        AGENT DIRECTORY
      </motion.h2>
      <p style={{ color: '#003344', fontSize: 11, marginBottom: 32, letterSpacing: 2 }}>
        SELECT AN AGENT TO OPEN HOLOGRAPHIC PROFILE
      </p>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
        gap: 16,
      }}>
        {AGENTS.map((agent) => (
          <AgentCard key={agent.id} agent={agent} onOpen={onOpenHologram} />
        ))}
      </div>
    </div>
  )
}

function ImmersiveView() {
  return (
    <div style={{ width: '100%', height: '100vh' }}>
      <NeuralBrainVisualization departments={DEPARTMENTS} />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// APP SHELL
// ─────────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { id: 'agents',    label: 'AGENTS' },
  { id: 'immersive', label: 'NEURAL MAP' },
]

export default function App() {
  const [view,       setView]       = useState('agents')
  const [holoAgent,  setHoloAgent]  = useState(null)

  return (
    <div style={{ minHeight: '100vh', background: '#000810' }}>
      {/* Nav bar */}
      <motion.nav
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 500,
          display: 'flex', alignItems: 'center', gap: 0,
          padding: '0 28px',
          borderBottom: '1px solid #001a2e',
          background: 'rgba(0,8,16,0.96)',
          backdropFilter: 'blur(12px)',
          height: 52,
          fontFamily: '"Space Mono", "Courier New", monospace',
        }}
      >
        <div style={{ color: '#00e5ff', fontSize: 13, letterSpacing: 4, marginRight: 48 }}>
          NEUROFORGE
        </div>

        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            onClick={() => setView(item.id)}
            style={{
              background: 'transparent',
              border: 'none',
              color: view === item.id ? '#00e5ff' : '#003344',
              fontFamily: 'inherit',
              fontSize: 11,
              letterSpacing: 3,
              padding: '0 20px',
              cursor: 'pointer',
              height: '100%',
              borderBottom: view === item.id ? '2px solid #00e5ff' : '2px solid transparent',
              transition: 'all 0.2s',
            }}
          >
            {item.label}
          </button>
        ))}

        <motion.div
          animate={{ opacity: [1, 0.4, 1] }}
          transition={{ duration: 1.8, repeat: Infinity }}
          style={{ marginLeft: 'auto', color: '#002244', fontSize: 10, letterSpacing: 3 }}
        >
          ◉ SYSTEM ONLINE
        </motion.div>
      </motion.nav>

      {/* Page content */}
      <AnimatePresence mode="wait">
        {view === 'agents' && (
          <motion.div
            key="agents"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            <AgentListView onOpenHologram={setHoloAgent} />
          </motion.div>
        )}

        {view === 'immersive' && (
          <motion.div
            key="immersive"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            style={{ width: '100%', height: '100vh' }}
          >
            <ImmersiveView />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Hologram overlay — rendered on top of everything */}
      <AnimatePresence>
        {holoAgent && (
          <motion.div
            key="hologram"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
            style={{ position: 'fixed', inset: 0, zIndex: 1000 }}
          >
            <HologramAvatar agent={holoAgent} onClose={() => setHoloAgent(null)} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
