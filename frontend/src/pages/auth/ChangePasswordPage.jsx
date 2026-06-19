import { Card, CardContent, TextField, Button, Stack } from '@mui/material';
import { useForm } from 'react-hook-form';
import { toast } from 'react-toastify';
import { authService } from '../../services';
import PageHeader from '../../components/common/PageHeader';

export default function ChangePasswordPage() {
  const { register, handleSubmit, reset, formState: { isSubmitting } } = useForm();
  const onSubmit = async (values) => {
    await authService.changePassword(values);
    toast.success('Password changed successfully');
    reset();
  };
  return (
    <>
      <PageHeader title="Change password" subtitle="Update your account password" />
      <Card sx={{ maxWidth: 520 }}>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)}>
            <Stack spacing={2}>
              <TextField type="password" label="Current password" fullWidth required {...register('currentPassword', { required: true })} />
              <TextField type="password" label="New password" fullWidth required {...register('newPassword', { required: true, minLength: 6 })} />
              <Button type="submit" variant="contained" disabled={isSubmitting}>
                {isSubmitting ? 'Saving…' : 'Update password'}
              </Button>
            </Stack>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
