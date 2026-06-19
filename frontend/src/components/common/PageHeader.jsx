import { Box, Typography, Stack } from '@mui/material';

export default function PageHeader({ title, subtitle, actions }) {
  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      justifyContent="space-between"
      alignItems={{ xs: 'flex-start', sm: 'center' }}
      gap={2}
      sx={{ mb: 3 }}
      className="fade-in-up"
    >
      <Box>
        <Typography
          variant="h5"
          sx={{
            fontWeight: 800,
            display: 'inline-block',
            position: 'relative',
            '&::after': {
              content: '""',
              position: 'absolute',
              left: 0,
              bottom: -6,
              height: 3,
              width: 36,
              borderRadius: 2,
              background: 'linear-gradient(90deg,#5b6ef5,#a855f7)',
            },
          }}
        >
          {title}
        </Typography>
        {subtitle && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>{subtitle}</Typography>
        )}
      </Box>
      {actions && <Stack direction="row" spacing={1}>{actions}</Stack>}
    </Stack>
  );
}
