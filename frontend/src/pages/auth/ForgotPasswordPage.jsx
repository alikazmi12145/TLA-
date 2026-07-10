import { Box, Card, CardContent, TextField, Button, Typography, Stack, Link as MLink } from '@mui/material';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import { authService } from '../../services';

export default function ForgotPasswordPage() {
  const { register, handleSubmit, formState: { isSubmitting } } = useForm();
  const onSubmit = async (values) => {
    await authService.forgotPassword(values);
    toast.success('If the email exists, a reset link has been sent');
  };
  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: 2, background: 'linear-gradient(135deg,#0b1020,#1a1f3d)' }}>
      <Card sx={{ width: { xs: '100%', sm: 420 }, maxWidth: '100%' }}>
        <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
          <Typography variant="h5" sx={{ fontWeight: 800, mb: 1 }}>Forgot password</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Enter your email to receive a reset link.
          </Typography>
          <form onSubmit={handleSubmit(onSubmit)}>
            <Stack spacing={2}>
              <TextField label="Email" fullWidth required {...register('email', { required: true })} />
              <Button type="submit" variant="contained" disabled={isSubmitting}>
                {isSubmitting ? 'Sending…' : 'Send reset link'}
              </Button>
              <MLink component={Link} to="/login" sx={{ textAlign: 'center' }}>Back to login</MLink>
            </Stack>
          </form>
        </CardContent>
      </Card>
    </Box>
  );
}
