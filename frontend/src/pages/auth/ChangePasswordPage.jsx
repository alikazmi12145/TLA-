import { useState } from 'react';
import {
  Card,
  CardContent,
  TextField,
  Button,
  Stack,
  Box,
  IconButton,
  InputAdornment,
} from '@mui/material';
import { Visibility, VisibilityOff } from '@mui/icons-material';
import { useForm } from 'react-hook-form';
import { toast } from 'react-toastify';
import { authService } from '../../services';
import PageHeader from '../../components/common/PageHeader';

export default function ChangePasswordPage() {
  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { isSubmitting, errors },
  } = useForm();

  const newPassword = watch('newPassword');

  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const onSubmit = async (values) => {
    try {
      // Don't send confirmPassword to backend
      const { confirmPassword, ...payload } = values;

      await authService.changePassword(payload);

      toast.success('Password changed successfully');
      reset();
    } catch (error) {
      toast.error(
        error?.response?.data?.message || 'Failed to change password'
      );
    }
  };

  return (
    <>
      <PageHeader
        title="Change Password"
        subtitle="Update your account password"
      />

      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: 'calc(100vh - 180px)',
          px: 2,
          py: 3,
        }}
      >
        <Card
          elevation={3}
          sx={{
            width: '100%',
            maxWidth: 520,
            borderRadius: 3,
          }}
        >
          <CardContent sx={{ p: 4 }}>
            <form onSubmit={handleSubmit(onSubmit)}>
              <Stack spacing={2.5}>
                {/* Current Password */}
                <TextField
                  type={showCurrentPassword ? 'text' : 'password'}
                  label="Current Password"
                  fullWidth
                  {...register('currentPassword', {
                    required: 'Current password is required',
                  })}
                  error={!!errors.currentPassword}
                  helperText={errors.currentPassword?.message}
                  InputProps={{
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          edge="end"
                          onClick={() =>
                            setShowCurrentPassword(!showCurrentPassword)
                          }
                        >
                          {showCurrentPassword ? (
                            <VisibilityOff />
                          ) : (
                            <Visibility />
                          )}
                        </IconButton>
                      </InputAdornment>
                    ),
                  }}
                />

                {/* New Password */}
                <TextField
                  type={showNewPassword ? 'text' : 'password'}
                  label="New Password"
                  fullWidth
                  {...register('newPassword', {
                    required: 'New password is required',
                    minLength: {
                      value: 6,
                      message: 'Password must be at least 6 characters',
                    },
                  })}
                  error={!!errors.newPassword}
                  helperText={errors.newPassword?.message}
                  InputProps={{
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          edge="end"
                          onClick={() =>
                            setShowNewPassword(!showNewPassword)
                          }
                        >
                          {showNewPassword ? (
                            <VisibilityOff />
                          ) : (
                            <Visibility />
                          )}
                        </IconButton>
                      </InputAdornment>
                    ),
                  }}
                />

                {/* Confirm Password */}
                <TextField
                  type={showConfirmPassword ? 'text' : 'password'}
                  label="Confirm New Password"
                  fullWidth
                  {...register('confirmPassword', {
                    required: 'Please confirm your new password',
                    validate: (value) =>
                      value === newPassword || 'Passwords do not match',
                  })}
                  error={!!errors.confirmPassword}
                  helperText={errors.confirmPassword?.message}
                  InputProps={{
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          edge="end"
                          onClick={() =>
                            setShowConfirmPassword(!showConfirmPassword)
                          }
                        >
                          {showConfirmPassword ? (
                            <VisibilityOff />
                          ) : (
                            <Visibility />
                          )}
                        </IconButton>
                      </InputAdornment>
                    ),
                  }}
                />

                <Button
                  type="submit"
                  variant="contained"
                  size="large"
                  disabled={isSubmitting}
                  sx={{
                    mt: 1,
                    py: 1.5,
                    borderRadius: 2,
                    fontWeight: 600,
                    textTransform: 'none',
                  }}
                >
                  {isSubmitting ? 'Saving...' : 'Update Password'}
                </Button>
              </Stack>
            </form>
          </CardContent>
        </Card>
      </Box>
    </>
  );
}