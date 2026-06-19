import { useEffect } from 'react';
import { Card, CardContent, Grid, TextField, MenuItem, Button, Stack, Avatar, Box, Typography, Checkbox, ListItemText, OutlinedInput, InputLabel, Select, FormControl } from '@mui/material';
import { useForm, Controller } from 'react-hook-form';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'react-toastify';

import PageHeader from '../../components/common/PageHeader';
import { employeeService, departmentService, shiftService } from '../../services';
import { ROLES } from '../../lib/constants';
import { asset, initials } from '../../lib/format';

const DAY_OPTIONS = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
];

export default function EmployeeFormPage() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();

  const { data: deps } = useQuery({ queryKey: ['departments'], queryFn: departmentService.list });
  const { data: shifts } = useQuery({ queryKey: ['shifts'], queryFn: shiftService.list });
  const { data: emp } = useQuery({
    queryKey: ['employee', id], queryFn: () => employeeService.get(id), enabled: isEdit,
  });

  const { register, handleSubmit, reset, control, watch, formState: { isSubmitting } } = useForm({
    defaultValues: {
      employeeId: '', fullName: '', email: '', phone: '', cnic: '', role: 'EMPLOYEE',
      department: '', designation: '', joiningDate: '', shift: '',
      basicSalary: 0, dailyTarget: 0, commissionRate: 0, status: 'ACTIVE', password: '',
      weeklyOffDays: [0],
    },
  });

  useEffect(() => {
    if (emp?.data) {
      const e = emp.data;
      reset({
        employeeId: e.employeeId || '',
        fullName: e.fullName || '',
        email: e.email || '',
        phone: e.phone || '',
        cnic: e.cnic || '',
        role: e.role,
        department: e.department?._id || e.department || '',
        designation: e.designation || '',
        joiningDate: e.joiningDate ? e.joiningDate.substring(0, 10) : '',
        shift: e.shift?._id || e.shift || '',
        basicSalary: e.basicSalary || 0,
        dailyTarget: e.dailyTarget || 0,
        commissionRate: e.commissionRate || 0,
        status: e.status || 'ACTIVE',
        password: '',
        weeklyOffDays: Array.isArray(e.weeklyOffDays) && e.weeklyOffDays.length ? e.weeklyOffDays.map(Number) : [0],
      });
    }
  }, [emp, reset]);

  const profilePic = watch('profilePicture');

  const onSubmit = async (values) => {
    const fd = new FormData();
    Object.entries(values).forEach(([k, v]) => {
      if (v === '' || v === undefined || v === null) return;
      if (typeof v === 'number' && Number.isNaN(v)) return;
      if (k === 'profilePicture' && v instanceof FileList) {
        if (v[0]) fd.append('profilePicture', v[0]);
      } else if (k === 'profilePicture' && v instanceof File) {
        fd.append('profilePicture', v);
      } else if (k === 'weeklyOffDays' && Array.isArray(v)) {
        fd.append('weeklyOffDays', v.join(','));
      } else {
        fd.append(k, v);
      }
    });
    try {
      if (isEdit) {
        await employeeService.update(id, fd);
        toast.success('Employee updated');
      } else {
        await employeeService.create(fd);
        toast.success('Employee created');
      }
      navigate('/employees');
    } catch {}
  };

  return (
    <>
      <PageHeader title={isEdit ? 'Edit Employee' : 'Add Employee'} />

      <Card>
        <CardContent sx={{ p: 3 }}>
          <form onSubmit={handleSubmit(onSubmit)}>
            <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 3 }}>
              <Avatar
                src={profilePic instanceof FileList && profilePic[0] ? URL.createObjectURL(profilePic[0]) : asset(emp?.data?.profilePicture)}
                sx={{ width: 72, height: 72 }}
              >
                {initials(emp?.data?.fullName)}
              </Avatar>
              <Box>
                <Typography variant="body2" color="text.secondary">Profile picture</Typography>
                <Button component="label" variant="outlined" size="small" sx={{ mt: 0.5 }}>
                  Upload
                  <input hidden type="file" accept="image/*" {...register('profilePicture')} />
                </Button>
              </Box>
            </Stack>

            <Grid container spacing={2}>
              <Grid item xs={12} md={4}><TextField label="Employee ID" fullWidth {...register('employeeId')} /></Grid>
              <Grid item xs={12} md={4}><TextField label="Full Name" fullWidth required {...register('fullName', { required: true })} /></Grid>
              <Grid item xs={12} md={4}><TextField label="Email" type="email" fullWidth required {...register('email', { required: true })} /></Grid>
              <Grid item xs={12} md={4}><TextField label="Phone" fullWidth {...register('phone')} /></Grid>
              <Grid item xs={12} md={4}><TextField label="CNIC" fullWidth {...register('cnic')} /></Grid>
              <Grid item xs={12} md={4}>
                <Controller name="role" control={control} render={({ field }) => (
                  <TextField select label="Role" fullWidth {...field}>
                    {Object.values(ROLES).map((r) => <MenuItem key={r} value={r}>{r.replace('_', ' ')}</MenuItem>)}
                  </TextField>
                )} />
              </Grid>
              <Grid item xs={12} md={4}>
                <Controller name="department" control={control} render={({ field }) => (
                  <TextField select label="Department" fullWidth {...field}>
                    <MenuItem value="">—</MenuItem>
                    {(deps?.data || []).map((d) => <MenuItem key={d._id} value={d._id}>{d.name}</MenuItem>)}
                  </TextField>
                )} />
              </Grid>
              <Grid item xs={12} md={4}><TextField label="Designation" fullWidth {...register('designation')} /></Grid>
              <Grid item xs={12} md={4}><TextField type="date" label="Joining Date" InputLabelProps={{ shrink: true }} fullWidth {...register('joiningDate')} /></Grid>
              <Grid item xs={12} md={4}>
                <Controller name="shift" control={control} render={({ field }) => (
                  <TextField select label="Shift" fullWidth {...field}>
                    <MenuItem value="">—</MenuItem>
                    {(shifts?.data || []).map((s) => <MenuItem key={s._id} value={s._id}>{s.name} ({s.startTime}-{s.endTime})</MenuItem>)}
                  </TextField>
                )} />
              </Grid>
              <Grid item xs={12} md={4}><TextField type="number" label="Basic Salary" fullWidth {...register('basicSalary', { valueAsNumber: true })} /></Grid>
              <Grid item xs={12} md={4}><TextField type="number" label="Daily Target" fullWidth {...register('dailyTarget', { valueAsNumber: true })} /></Grid>
              <Grid item xs={12} md={4}><TextField type="number" label="Commission %" fullWidth {...register('commissionRate', { valueAsNumber: true })} /></Grid>
              <Grid item xs={12} md={4}>
                <Controller
                  name="weeklyOffDays"
                  control={control}
                  render={({ field }) => (
                    <FormControl fullWidth>
                      <InputLabel id="off-days-label">Weekly Off Days</InputLabel>
                      <Select
                        multiple
                        labelId="off-days-label"
                        input={<OutlinedInput label="Weekly Off Days" />}
                        value={Array.isArray(field.value) ? field.value : []}
                        onChange={(e) => field.onChange(
                          typeof e.target.value === 'string'
                            ? e.target.value.split(',').map(Number)
                            : e.target.value
                        )}
                        renderValue={(selected) =>
                          selected
                            .slice()
                            .sort((a, b) => a - b)
                            .map((v) => DAY_OPTIONS.find((d) => d.value === v)?.label.slice(0, 3))
                            .filter(Boolean)
                            .join(', ')
                        }
                      >
                        {DAY_OPTIONS.map((d) => (
                          <MenuItem key={d.value} value={d.value}>
                            <Checkbox checked={(field.value || []).indexOf(d.value) > -1} />
                            <ListItemText primary={d.label} />
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  )}
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <Controller name="status" control={control} render={({ field }) => (
                  <TextField select label="Status" fullWidth {...field}>
                    {['ACTIVE', 'INACTIVE', 'TERMINATED', 'ON_LEAVE'].map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
                  </TextField>
                )} />
              </Grid>
              {!isEdit && (
                <Grid item xs={12} md={4}>
                  <TextField label="Initial Password" type="password" fullWidth helperText="Defaults to Welcome@123 if empty" {...register('password')} />
                </Grid>
              )}
            </Grid>

            <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mt: 3 }}>
              <Button onClick={() => navigate(-1)}>Cancel</Button>
              <Button type="submit" variant="contained" disabled={isSubmitting}>
                {isSubmitting ? 'Saving…' : isEdit ? 'Save changes' : 'Create employee'}
              </Button>
            </Stack>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
