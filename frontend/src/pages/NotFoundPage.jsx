import { Box, Button, Typography } from '@mui/material';
import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: 2 }}>
      <Box sx={{ textAlign: 'center' }}>
        <Typography variant="h1" sx={{ fontWeight: 900, fontSize: 96, lineHeight: 1, background: 'linear-gradient(135deg,#5b6ef5,#a855f7)', WebkitBackgroundClip: 'text', color: 'transparent' }}>
          404
        </Typography>
        <Typography variant="h6" sx={{ mb: 2 }}>Page not found</Typography>
        <Button component={Link} to="/" variant="contained">Go home</Button>
      </Box>
    </Box>
  );
}
