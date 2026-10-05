import { Box, Card, CardContent, TextField, Button, Typography, Stack } from '@mui/material';
import { useForm } from 'react-hook-form';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import { authService } from '../../services';

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const { register, handleSubmit, getValues, formState: { errors, isSubmitting } } = useForm({
    defaultValues: { email: params.get('email') || '' },
  });
  const navigate = useNavigate();
  const onSubmit = async (values) => {
    try {
      await authService.resetPassword({
        email: values.email,
        token: params.get('token'),
        newPassword: values.newPassword,
      });
      toast.success('Password reset! Please sign in.');
      navigate('/login');
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || 'Unable to reset password');
    }
  };
  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: 2, background: 'linear-gradient(135deg,#0b1020,#1a1f3d)' }}>
      <Card sx={{ width: { xs: '100%', sm: 460 }, maxWidth: '100%' }}>
        <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
          <Typography variant="h5" sx={{ fontWeight: 800, mb: 1 }}>Reset password</Typography>
          <form onSubmit={handleSubmit(onSubmit)}>
            <Stack spacing={2}>
              <TextField label="Email" fullWidth required {...register('email', { required: true })} />
              <TextField
                type="password"
                label="New Password"
                fullWidth
                error={!!errors.newPassword}
                helperText={errors.newPassword?.message}
                {...register('newPassword', {
                  required: 'New password is required',
                  minLength: { value: 6, message: 'Password must be at least 6 characters' },
                })}
              />
              <TextField
                type="password"
                label="Confirm Password"
                fullWidth
                error={!!errors.confirmPassword}
                helperText={errors.confirmPassword?.message}
                {...register('confirmPassword', {
                  required: 'Please confirm your new password',
                  validate: (value) => value === getValues('newPassword') || 'Passwords do not match',
                })}
              />
              <Button type="submit" variant="contained" disabled={isSubmitting}>
                {isSubmitting ? 'Saving…' : 'Reset Password'}
              </Button>
            </Stack>
          </form>
        </CardContent>
      </Card>
    </Box>
  );
}
