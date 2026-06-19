import { Card, CardContent, Box, Typography, Skeleton } from '@mui/material';

export default function StatCard({ title, value, icon, color = 'primary', subtitle, loading }) {
  return (
    <Card
      sx={{
        position: 'relative',
        overflow: 'hidden',
        cursor: 'default',
        transition: 'transform .25s ease, box-shadow .25s ease, border-color .25s ease',
        '&::before': {
          content: '""',
          position: 'absolute',
          inset: 0,
          padding: '1px',
          borderRadius: 'inherit',
          background:
            'linear-gradient(135deg, rgba(91,110,245,0.4), rgba(168,85,247,0.4))',
          WebkitMask:
            'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
          WebkitMaskComposite: 'xor',
          maskComposite: 'exclude',
          opacity: 0,
          transition: 'opacity .25s ease',
          pointerEvents: 'none',
        },
        '&:hover': {
          transform: 'translateY(-5px)',
          boxShadow: (t) =>
            t.palette.mode === 'light'
              ? '0 20px 45px rgba(20,23,31,0.10)'
              : '0 20px 45px rgba(0,0,0,0.5)',
        },
        '&:hover::before': { opacity: 1 },
        '&:hover .stat-icon': {
          transform: 'scale(1.08) rotate(-3deg)',
          boxShadow: (t) =>
            `0 8px 22px ${t.palette[color]?.main || t.palette.primary.main}55`,
        },
      }}
    >
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          background: (t) =>
            `linear-gradient(135deg, ${t.palette[color]?.main || t.palette.primary.main}14, transparent 60%)`,
        }}
      />
      <CardContent sx={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 2 }}>
        <Box
          className="stat-icon"
          sx={{
            width: 52,
            height: 52,
            borderRadius: 3,
            display: 'grid',
            placeItems: 'center',
            background: (t) => `${t.palette[color]?.main || t.palette.primary.main}20`,
            color: (t) => t.palette[color]?.main || t.palette.primary.main,
            transition: 'transform .25s ease, box-shadow .25s ease',
          }}
        >
          {icon}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.6 }}>
            {title}
          </Typography>
          {loading ? (
            <Skeleton variant="text" width="60%" sx={{ fontSize: 24 }} />
          ) : (
            <Typography variant="h5" sx={{ fontWeight: 800 }}>
              {value}
            </Typography>
          )}
          {subtitle && (
            <Typography variant="caption" color="text.secondary">
              {subtitle}
            </Typography>
          )}
        </Box>
      </CardContent>
    </Card>
  );
}
