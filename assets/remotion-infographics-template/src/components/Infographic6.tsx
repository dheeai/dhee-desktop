import React from 'react';
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
  Sequence,
} from 'remotion';
import { ThreeCanvas } from '@remotion/three';

interface InfographicProps {
  prompt: string;
  infographicType: string;
  data?: Record<string, unknown>;
}

export const Infographic6: React.FC<InfographicProps> = () => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  // Data for the process flow
  const steps = [
    { id: 1, label: 'Research', delay: 0 },
    { id: 2, label: 'Design', delay: 15 },
    { id: 3, label: 'Develop', delay: 30 },
    { id: 4, label: 'Launch', delay: 45 },
  ];

  // 3D Rotation Animation for the entire group
  const groupRotationY = interpolate(frame, [0, 120], [0, Math.PI * 0.2], {
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill
      style={{
        background: 'transparent',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      {/* 3D Layer */}
      <AbsoluteFill style={{ zIndex: 0 }}>
        <ThreeCanvas width={width} height={height} camera={{ position: [0, 2, 14], fov: 50 }}>
          <ambientLight intensity={0.5} />
          <directionalLight position={[8, 10, 6]} intensity={1.2} castShadow />
          <pointLight position={[-5, 5, -5]} intensity={0.6} color="#6366f1" />

          <group rotation={[0, groupRotationY, 0]}>
            {/* 3D Flow Nodes */}
            {steps.map((step, i) => {
              const xPos = (i - 1.5) * 3.5;
              const entrance = spring({
                frame: frame - step.delay,
                fps,
                config: { damping: 15, stiffness: 80 },
              });

              // Floating effect
              const floatY = Math.sin(frame * 0.03 + i) * 0.3;

              return (
                <mesh key={i} position={[xPos, floatY, 0]} scale={entrance} visible={entrance > 0.01}>
                  <octahedronGeometry args={[1.2, 0]} />
                  <meshStandardMaterial
                    color={i === 3 ? '#a855f7' : '#3b82f6'}
                    metalness={0.3}
                    roughness={0.2}
                    emissive={i === 3 ? '#a855f7' : '#3b82f6'}
                    emissiveIntensity={0.2}
                  />
                </mesh>
              );
            })}

            {/* Connecting Lines (Cylinders) */}
            {steps.map((_, i) => {
              if (i === steps.length - 1) return null;
              const startX = (i - 1.5) * 3.5;
              const endX = (i + 1 - 1.5) * 3.5;
              const lineDelay = steps[i].delay + 20;
              const lineProgress = interpolate(
                frame,
                [lineDelay, lineDelay + 30],
                [0, 1],
                { extrapolateRight: 'clamp' }
              );

              if (lineProgress <= 0.01) return null;

              return (
                <mesh key={`line-${i}`} position={[(startX + endX) / 2, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
                  <cylinderGeometry args={[0.1, 0.1, 3.5, 16]} />
                  <meshStandardMaterial color="#94a3b8" opacity={0.6} transparent />
                </mesh>
              );
            })}
          </group>
        </ThreeCanvas>
      </AbsoluteFill>

      {/* 2D Overlay Layer */}
      <AbsoluteFill style={{ zIndex: 1 }}>
        <Sequence from={0} layout="none">
          {/* Title Card */}
          <div
            style={{
              position: 'absolute',
              top: '80px',
              left: '50%',
              transform: `translateX(-50%) translateY(${interpolate(spring({ frame, fps, config: { damping: 200 } }), [0, 1], [40, 0])}px)`,
              padding: '28px 56px',
              borderRadius: '32px',
              background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.9), rgba(30, 41, 59, 0.7))',
              backdropFilter: 'blur(16px)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              boxShadow: '0 25px 50px rgba(0,0,0,0.5), 0 0 30px rgba(99, 102, 241, 0.3)',
              opacity: spring({ frame, fps, config: { damping: 200 } }),
              textAlign: 'center',
            }}
          >
            <h1
              style={{
                fontSize: '64px',
                fontWeight: 800,
                color: '#f8fafc',
                margin: 0,
                letterSpacing: '-0.03em',
                textShadow: '0 4px 12px rgba(0,0,0,0.5)',
              }}
            >
              Project Lifecycle
            </h1>
            <div
              style={{
                width: '120px',
                height: '6px',
                background: 'linear-gradient(90deg, #3b82f6, #a855f7)',
                margin: '20px auto 0',
                borderRadius: '3px',
                transform: `scaleX(${interpolate(frame, [10, 50], [0, 1], { extrapolateRight: 'clamp' })})`,
                transformOrigin: 'left',
              }}
            />
          </div>
        </Sequence>

        {/* Step Labels */}
        <div
          style={{
            position: 'absolute',
            bottom: '140px',
            width: '100%',
            display: 'flex',
            justifyContent: 'space-around',
            paddingLeft: '140px',
            paddingRight: '140px',
          }}
        >
          {steps.map((step, i) => {
            const labelEntrance = spring({
              frame: frame - step.delay - 10,
              fps,
              config: { damping: 20, stiffness: 90 },
            });
            const labelY = interpolate(labelEntrance, [0, 1], [30, 0], {
              extrapolateRight: 'clamp',
            });

            return (
              <Sequence key={i} from={0} layout="none">
                <div
                  style={{
                    opacity: labelEntrance,
                    transform: `translateY(${labelY}px)`,
                    textAlign: 'center',
                  }}
                >
                  <div
                    style={{
                      width: '64px',
                      height: '64px',
                      borderRadius: '50%',
                      background: 'linear-gradient(135deg, #3b82f6, #a855f7)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      margin: '0 auto 16px',
                      boxShadow: '0 10px 25px rgba(59, 130, 246, 0.5)',
                      border: '2px solid rgba(255,255,255,0.3)',
                      fontSize: '28px',
                      fontWeight: 700,
                      color: 'white',
                    }}
                  >
                    {i + 1}
                  </div>
                  <div
                    style={{
                      fontSize: '32px',
                      fontWeight: 700,
                      color: '#f1f5f9',
                      textShadow: '0 2px 8px rgba(0,0,0,0.6)',
                      letterSpacing: '0.02em',
                    }}
                  >
                    {step.label}
                  </div>
                </div>
              </Sequence>
            );
          })}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
