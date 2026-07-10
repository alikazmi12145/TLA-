import { Box, Card, CardContent, Typography, TextField, Button, InputAdornment, IconButton, Stack, Link as MLink } from '@mui/material';
import { Visibility, VisibilityOff, Badge as BadgeIcon, Lock } from '@mui/icons-material';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate, Link } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { toast } from 'react-toastify';
import { authService } from '../../services';
import { setCredentials } from '../../features/auth/authSlice';
import TLALogo from '../../components/common/TLALogo';

export default function LoginPage() {
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm();
  const [showPwd, setShowPwd] = useState(false);
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const onSubmit = async (values) => {
    try {
      const res = await authService.login({
        userId: values.userId.trim(),
        password: values.password,
      });
      dispatch(setCredentials(res.data));
      toast.success('Welcome back!');
      navigate('/');
    } catch {/* toast handled by interceptor */}
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        background: 'radial-gradient(1200px 600px at 10% -10%, #5b6ef555, transparent), radial-gradient(800px 500px at 110% 110%, #a855f755, transparent), linear-gradient(135deg,#0b1020,#1a1f3d)',
        p: 2,
      }}
    >
      <Card sx={{ width: { xs: '100%', sm: 440 }, maxWidth: '100%', backdropFilter: 'blur(20px)', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
        <CardContent sx={{ p: { xs: 3, sm: 4 }, color: '#fff' }}>
          <Box sx={{ textAlign: 'center', mb: 3, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <TLALogo size={104} sx={{ mb: 1.5 }} />
            <Typography variant="h4" sx={{ fontWeight: 800, letterSpacing: 4, background: 'linear-gradient(135deg,#5b6ef5,#a855f7)', WebkitBackgroundClip: 'text', color: 'transparent' }}>
              T.L.A
            </Typography>
            <Typography variant="caption" sx={{ opacity: 0.6, letterSpacing: 3, mt: 0.25 }}>THE LIVE AGENTS</Typography>
            <Typography variant="body2" sx={{ opacity: 0.75, mt: 1.5 }}>Sign in to your workspace</Typography>
          </Box>
          <form onSubmit={handleSubmit(onSubmit)}>
            <Stack spacing={2}>
              <TextField
                label="User ID"
                placeholder="e.g. TLA-0001"
                fullWidth
                variant="outlined"
                autoFocus
                error={!!errors.userId}
                helperText={errors.userId?.message || 'Use your Employee ID or email'}
                {...register('userId', { required: 'User ID is required' })}
                InputProps={{ startAdornment: <InputAdornment position="start"><BadgeIcon fontSize="small" /></InputAdornment> }}
                sx={inputSx}
              />
              <TextField
                label="Password"
                fullWidth
                type={showPwd ? 'text' : 'password'}
                error={!!errors.password}
                helperText={errors.password?.message}
                {...register('password', { required: 'Password is required' })}
                InputProps={{
                  startAdornment: <InputAdornment position="start"><Lock fontSize="small" /></InputAdornment>,
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton onClick={() => setShowPwd((s) => !s)} sx={{ color: 'rgba(255,255,255,0.7)' }}>
                        {showPwd ? <VisibilityOff /> : <Visibility />}
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
                sx={inputSx}
              />
              <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                <MLink component={Link} to="/forgot-password" sx={{ color: '#a4b1ff', fontSize: 13 }}>Forgot password?</MLink>
              </Box>
              <Button
                type="submit"
                disabled={isSubmitting}
                size="large"
                variant="contained"
                sx={{
                  py: 1.4, mt: 1,
                  background: 'linear-gradient(135deg,#5b6ef5,#a855f7)',
                  '&:hover': { background: 'linear-gradient(135deg,#4d60e8,#9542e3)' },
                }}
              >
                {isSubmitting ? 'Signing in…' : 'Sign in'}
              </Button>
            </Stack>
          </form>
        </CardContent>
      </Card>
    </Box>
  );
}

const inputSx = {
  '& .MuiOutlinedInput-root': {
    color: '#fff',
    '& fieldset': { borderColor: 'rgba(255,255,255,0.18)' },
    '&:hover fieldset': { borderColor: 'rgba(255,255,255,0.35)' },
    '&.Mui-focused fieldset': { borderColor: '#a855f7' },
  },
  '& .MuiInputLabel-root': { color: 'rgba(255,255,255,0.7)' },
  '& .MuiInputAdornment-root .MuiSvgIcon-root': { color: 'rgba(255,255,255,0.6)' },
};
