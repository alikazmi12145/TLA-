import { Box } from '@mui/material';

export default function TLALogo({ size = 96, sx = {} }) {
  return (
    <Box
      className="tla-logo"
      sx={{
        width: size,
        height: size,
        display: 'inline-flex',
        cursor: 'pointer',
        animation: 'tla-float 4s ease-in-out infinite',
        filter: 'drop-shadow(0 6px 18px rgba(91, 110, 245, 0.45))',
        transition: 'transform 0.45s cubic-bezier(0.34, 1.56, 0.64, 1), filter 0.3s ease',
        '&:hover': {
          transform: 'scale(1.12) rotate(-4deg)',
          filter: 'drop-shadow(0 14px 32px rgba(168, 85, 247, 0.7))',
          '& .tla-bubble': { fillOpacity: 0.55 },
          '& .tla-node': { animationDuration: '0.9s' },
          '& .tla-link': { strokeOpacity: 1 },
        },
        '@keyframes tla-float': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        },
        '@keyframes tla-pulse': {
          '0%, 100%': { transform: 'scale(1)', opacity: 1 },
          '50%': { transform: 'scale(1.28)', opacity: 0.85 },
        },
        ...sx,
      }}
    >
      <svg viewBox="0 0 200 200" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="tla-bubble-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#5b6ef5" />
            <stop offset="100%" stopColor="#a855f7" />
          </linearGradient>
          <radialGradient id="tla-node-grad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="100%" stopColor="#dbe2ff" />
          </radialGradient>
          <filter id="tla-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.8" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Speech bubble: circle body + triangular tail at bottom-right (transparent / glass fill) */}
        <g
          className="tla-bubble"
          fill="url(#tla-bubble-grad)"
          fillOpacity="0.38"
          stroke="url(#tla-bubble-grad)"
          strokeWidth="2"
          strokeOpacity="0.9"
          style={{ transition: 'fill-opacity 0.4s ease' }}
        >
          <circle cx="100" cy="98" r="86" />
          <path d="M 138,168 L 172,196 L 128,180 Z" />
        </g>

        {/* Network connections */}
        <g
          className="tla-link"
          stroke="#ffffff"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeOpacity="0.55"
          fill="none"
          style={{ transition: 'stroke-opacity 0.3s ease' }}
        >
          {/* Center hub spokes */}
          <line x1="105" y1="120" x2="60" y2="55" />
          <line x1="105" y1="120" x2="135" y2="40" />
          <line x1="105" y1="120" x2="165" y2="78" />
          <line x1="105" y1="120" x2="48" y2="105" />
          <line x1="105" y1="120" x2="60" y2="170" />
          <line x1="105" y1="120" x2="160" y2="160" />

          {/* Outer node → bubble perimeter (anchors the network to the globe edge) */}
          {/* top-left node (60,55) */}
          <line x1="60" y1="55" x2="36" y2="32" />
          <line x1="60" y1="55" x2="100" y2="12" />
          {/* top-center node (135,40) */}
          <line x1="135" y1="40" x2="100" y2="12" />
          <line x1="135" y1="40" x2="170" y2="35" />
          {/* top-right node (165,78) */}
          <line x1="165" y1="78" x2="170" y2="35" />
          <line x1="165" y1="78" x2="185" y2="100" />
          {/* mid-left node (48,105) */}
          <line x1="48" y1="105" x2="36" y2="32" />
          <line x1="48" y1="105" x2="15" y2="115" />
          {/* bottom-left node (60,170) */}
          <line x1="60" y1="170" x2="15" y2="115" />
          <line x1="60" y1="170" x2="95" y2="184" />
          {/* bottom-right node (160,160) */}
          <line x1="160" y1="160" x2="185" y2="100" />
          <line x1="160" y1="160" x2="138" y2="168" />
          <line x1="160" y1="160" x2="95" y2="184" />
        </g>

        {/* Network nodes with staggered pulse */}
        <g fill="url(#tla-node-grad)" filter="url(#tla-glow)">
          <circle className="tla-node" cx="105" cy="120" r="13" style={{ transformOrigin: '105px 120px', animation: 'tla-pulse 2.6s ease-in-out infinite' }} />
          <circle className="tla-node" cx="60" cy="55" r="7" style={{ transformOrigin: '60px 55px', animation: 'tla-pulse 2.6s ease-in-out infinite 0.2s' }} />
          <circle className="tla-node" cx="135" cy="40" r="9" style={{ transformOrigin: '135px 40px', animation: 'tla-pulse 2.6s ease-in-out infinite 0.4s' }} />
          <circle className="tla-node" cx="165" cy="78" r="9" style={{ transformOrigin: '165px 78px', animation: 'tla-pulse 2.6s ease-in-out infinite 0.6s' }} />
          <circle className="tla-node" cx="48" cy="105" r="10" style={{ transformOrigin: '48px 105px', animation: 'tla-pulse 2.6s ease-in-out infinite 0.8s' }} />
          <circle className="tla-node" cx="60" cy="170" r="7" style={{ transformOrigin: '60px 170px', animation: 'tla-pulse 2.6s ease-in-out infinite 1s' }} />
          <circle className="tla-node" cx="160" cy="160" r="8" style={{ transformOrigin: '160px 160px', animation: 'tla-pulse 2.6s ease-in-out infinite 1.2s' }} />
        </g>
      </svg>
    </Box>
  );
}

