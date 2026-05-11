import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';

interface InfographicProps {
  prompt: string;
  infographicType: string;
  data?: Record<string, unknown>;
}

export const Infographic3: React.FC<InfographicProps> = ({ data }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const title = "Iconic Tracks";

  // Defining tracks data since input data is empty
  const tracks = [
    { name: "Monaco Grand Prix", icon: "anchor" },
    { name: "Suzuka Circuit", icon: "curve" },
    { name: "Silverstone GP", icon: "flag" }
  ];

  // Beat 1: Title Entrance (Frames 0-20)
  const titleSpring = spring({
    frame,
    fps,
    config: { damping: 200 }
  });

  const titleOpacity = titleSpring;
  const titleY = interpolate(titleSpring, [0, 1], [30, 0], {
    extrapolateRight: 'clamp'
  });

  return (
    <AbsoluteFill style={{ background: 'transparent', fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif' }}>
      <div style={{ position: 'absolute', left: 60, top: 120, perspective: '1000px' }}>
        {/* Title Section */}
        <div
          style={{
            fontSize: '64px',
            fontWeight: 800,
            color: '#ffffff',
            marginBottom: '40px',
            textShadow: '0 4px 16px rgba(0,0,0,0.8)',
            opacity: titleOpacity,
            transform: `translateY(${titleY}px)`,
            letterSpacing: '-1.5px',
            background: 'linear-gradient(135deg, #2dd4bf, #3b82f6)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent'
          }}
        >
          {title}
        </div>

        {/* List Section */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
          {tracks.map((track, i) => {
            // Staggered Timing: Monaco(0), Suzuka(15), Silverstone(30)
            const delay = i * 15;
            const itemSpring = spring({
              frame: frame - delay,
              fps,
              config: { damping: 15, stiffness: 90 }
            });

            // CSS 3D Depth Illusion Calculation
            const posX = interpolate(itemSpring, [0, 1], [-100, 0], { extrapolateRight: 'clamp' });
            const scaleVal = interpolate(itemSpring, [0, 1], [0.9, 1.0], { extrapolateRight: 'clamp' });
            const rotateYVal = interpolate(itemSpring, [0, 1], [-3, 0], { extrapolateRight: 'clamp' });

            // SVG Icon Selection
            const renderIcon = () => {
              const commonProps = {
                width: 24,
                height: 24,
                strokeWidth: 2.5,
                strokeLinecap: 'round',
                strokeLinejoin: 'round',
              } as const;
              if (track.icon === 'anchor') {
                return (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...commonProps}>
                    <circle cx="12" cy="5" r="3" />
                    <line x1="12" y1="22" x2="12" y2="8" />
                    <path d="M5 12H2a10 10 0 0 0 20 0h-3" />
                  </svg>
                );
              }
              if (track.icon === 'curve') {
                return (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...commonProps}>
                    <path d="M4 12c4-4 12-4 16 0" />
                    <circle cx="12" cy="12" r="2" />
                  </svg>
                );
              }
              return (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...commonProps}>
                  <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
                  <line x1="4" y1="22" x2="4" y2="15" />
                </svg>
              );
            };

            return (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  opacity: itemSpring,
                  transform: `translateX(${posX}px) scale(${scaleVal}) rotateY(${rotateYVal}deg)`,
                  transformStyle: 'preserve-3d',
                  filter: `drop-shadow(0 4px 12px rgba(0,0,0,0.5))`
                }}
              >
                {/* Circular Icon Container */}
                <div
                  style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: '50%',
                    background: 'linear-gradient(135deg, #0f766e, #2dd4bf)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#ffffff',
                    boxShadow: '0 10px 25px rgba(45, 212, 191, 0.3)',
                    marginRight: '24px',
                    flexShrink: 0,
                    border: '1px solid rgba(255,255,255,0.2)'
                  }}
                >
                  {renderIcon()}
                </div>

                {/* Track Name Text */}
                <div
                  style={{
                    fontSize: '28px',
                    fontWeight: 700,
                    color: '#ffffff',
                    textShadow: '0 4px 12px rgba(0,0,0,0.8)',
                    letterSpacing: '-0.02em',
                    transform: 'translateZ(20px)' // Extra Z depth for text
                  }}
                >
                  {track.name}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};