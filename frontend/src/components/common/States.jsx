import { Box, CircularProgress, Skeleton, Stack } from '@mui/material';

export const Loading = ({ height = 240 }) => (
  <Box sx={{ display: 'grid', placeItems: 'center', height }}>
    <CircularProgress />
  </Box>
);

export const TableSkeleton = ({ rows = 6 }) => (
  <Stack spacing={1}>
    {Array.from({ length: rows }).map((_, i) => (
      <Skeleton key={i} variant="rectangular" height={48} sx={{ borderRadius: 2 }} />
    ))}
  </Stack>
);

export const Empty = ({ title = 'Nothing to show', subtitle, icon }) => (
  <Box sx={{ textAlign: 'center', py: 6, opacity: 0.85 }}>
    <Box sx={{ fontSize: 48, mb: 1 }}>{icon || '📭'}</Box>
    <Box sx={{ fontWeight: 700 }}>{title}</Box>
    {subtitle && <Box sx={{ fontSize: 13, color: 'text.secondary' }}>{subtitle}</Box>}
  </Box>
);

export const ErrorState = ({ message = 'Something went wrong' }) => (
  <Box sx={{ textAlign: 'center', py: 6, color: 'error.main' }}>
    <Box sx={{ fontSize: 48 }}>⚠️</Box>
    <Box sx={{ fontWeight: 700 }}>{message}</Box>
  </Box>
);
