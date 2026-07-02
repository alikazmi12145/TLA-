import { useEffect } from 'react';
import { Card, CardContent, Grid, TextField, MenuItem, Button, Stack, FormControlLabel, Switch } from '@mui/material';
import { useForm, Controller } from 'react-hook-form';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'react-toastify';

import PageHeader from '../../components/common/PageHeader';
import { deviceService } from '../../services';
import { DEVICE_CONN_TYPE } from '../../lib/constants';

const DEFAULTS = {
  name: '', ip: '', port: 4370, inport: 5200, connectionType: 'TCP', commKey: 0,
  serialNumber: '', firmware: '', model: 'ZKTeco K40', location: '',
  enabled: true, isPrimary: false,
};

export default function DeviceFormPage() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();

  const { data } = useQuery({
    queryKey: ['device', id], queryFn: () => deviceService.get(id), enabled: isEdit,
  });

  const { register, handleSubmit, reset, control, formState: { isSubmitting } } = useForm({ defaultValues: DEFAULTS });

  useEffect(() => {
    if (data?.data) reset({ ...DEFAULTS, ...data.data });
  }, [data, reset]);

  const onSubmit = async (values) => {
    const payload = {
      ...values,
      port: Number(values.port),
      inport: Number(values.inport),
      commKey: Number(values.commKey) || 0,
    };
    try {
      if (isEdit) {
        await deviceService.update(id, payload);
        toast.success('Device updated');
      } else {
        await deviceService.create(payload);
        toast.success('Device created');
      }
      navigate('/devices');
    } catch {
      /* toast is emitted by axios interceptor */
    }
  };

  return (
    <>
      <PageHeader title={isEdit ? 'Edit Device' : 'Add Device'} subtitle="ZKTeco K40 or compatible biometric terminal" />
      <Card>
        <CardContent sx={{ p: 3 }}>
          <form onSubmit={handleSubmit(onSubmit)}>
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}><TextField label="Device Name" fullWidth required {...register('name', { required: true })} /></Grid>
              <Grid item xs={12} md={6}><TextField label="Model" fullWidth {...register('model')} /></Grid>
              <Grid item xs={12} md={4}><TextField label="Device IP" fullWidth required placeholder="192.168.1.201" {...register('ip', { required: true })} /></Grid>
              <Grid item xs={6} md={2}><TextField label="Port" type="number" fullWidth {...register('port')} /></Grid>
              <Grid item xs={6} md={2}><TextField label="UDP inport" type="number" fullWidth {...register('inport')} /></Grid>
              <Grid item xs={12} md={4}>
                <Controller name="connectionType" control={control} render={({ field }) => (
                  <TextField select label="Connection Type" fullWidth {...field}>
                    {DEVICE_CONN_TYPE.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
                  </TextField>
                )} />
              </Grid>
              <Grid item xs={12} md={4}><TextField label="Serial Number" fullWidth {...register('serialNumber')} /></Grid>
              <Grid item xs={12} md={4}><TextField label="Firmware" fullWidth {...register('firmware')} /></Grid>
              <Grid item xs={12} md={4}><TextField label="Comm Key" type="number" fullWidth helperText="0 if not set on device" {...register('commKey')} /></Grid>
              <Grid item xs={12} md={8}><TextField label="Location" fullWidth {...register('location')} /></Grid>
              <Grid item xs={12} md={4}>
                <Stack direction="row" spacing={2} alignItems="center" sx={{ pt: 1 }}>
                  <Controller name="enabled" control={control} render={({ field }) => (
                    <FormControlLabel control={<Switch checked={!!field.value} onChange={(e) => field.onChange(e.target.checked)} />} label="Enabled" />
                  )} />
                  <Controller name="isPrimary" control={control} render={({ field }) => (
                    <FormControlLabel control={<Switch checked={!!field.value} onChange={(e) => field.onChange(e.target.checked)} />} label="Primary" />
                  )} />
                </Stack>
              </Grid>
            </Grid>

            <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mt: 3 }}>
              <Button onClick={() => navigate(-1)}>Cancel</Button>
              <Button type="submit" variant="contained" disabled={isSubmitting}>
                {isSubmitting ? 'Saving…' : isEdit ? 'Save changes' : 'Create device'}
              </Button>
            </Stack>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
