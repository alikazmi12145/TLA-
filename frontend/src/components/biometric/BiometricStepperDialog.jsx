import { useEffect, useRef, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Stepper, Step, StepLabel,
  Box, Typography, Alert, CircularProgress, Chip, Stack, LinearProgress,
} from '@mui/material';
import FingerprintIcon from '@mui/icons-material/Fingerprint';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';

import { employeeService } from '../../services';

const STEPS = [
  'Saving employee',
  'Connecting device',
  'Creating user',
  'Updating database',
  'Awaiting fingerprint',
];

const POLL_INTERVAL_MS = 3000;

/**
 * Modal that walks the admin through the multi-step create-employee flow.
 * After the sync step succeeds it enters the "Awaiting fingerprint" phase
 * and polls the enrollment-status endpoint until the finger is enrolled
 * on the biometric device.
 *
 * Props:
 *   open        boolean
 *   activeStep  number (0..STEPS.length-1)
 *   error       string | null
 *   result      { employee?, biometric?: { ok, error? } } | null
 *   onClose     ()
 *   onGoToList  ()
 */
export default function BiometricStepperDialog({ open, activeStep, error, result, onClose, onGoToList }) {
  const biometric = result?.biometric || null;
  const employee = result?.employee || null;
  const biometricOk = !!biometric?.ok;
  const inEnrollmentPhase =
    activeStep >= STEPS.length - 1 && !error && biometricOk && !!employee?._id;

  const [enrollment, setEnrollment] = useState({
    enrolled: false,
    fingerCount: 0,
    deviceUserId: employee?.deviceUserId || null,
    lastError: null,
    polling: false,
  });
  const timerRef = useRef(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!open) return undefined;
    cancelledRef.current = false;
    setEnrollment({
      enrolled: false,
      fingerCount: 0,
      deviceUserId: employee?.deviceUserId || null,
      lastError: null,
      polling: false,
    });
    return () => {
      cancelledRef.current = true;
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    };
  }, [open, employee?._id]);

  useEffect(() => {
    if (!inEnrollmentPhase) return undefined;
    let stopped = false;
    const poll = async () => {
      if (stopped || cancelledRef.current) return;
      setEnrollment((prev) => ({ ...prev, polling: true }));
      try {
        const res = await employeeService.enrollmentStatus(employee._id);
        const d = res?.data || {};
        if (stopped || cancelledRef.current) return;
        setEnrollment({
          enrolled: !!d.enrolled,
          fingerCount: Number(d.fingerCount) || 0,
          deviceUserId: d.deviceUserId || employee?.deviceUserId || null,
          lastError: d.error || null,
          polling: false,
        });
        if (d.enrolled) return;
      } catch (err) {
        if (stopped || cancelledRef.current) return;
        setEnrollment((prev) => ({
          ...prev,
          polling: false,
          lastError: err?.response?.data?.message || err.message || 'Poll failed',
        }));
      }
      timerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
    };
    poll();
    return () => {
      stopped = true;
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    };
  }, [inEnrollmentPhase, employee?._id]);

  const done = activeStep >= STEPS.length - 1;
  const finishedEnrollment = enrollment.enrolled;
  const closable = !!error || !biometricOk || finishedEnrollment;

  const forceRefresh = async () => {
    if (!employee?._id) return;
    setEnrollment((prev) => ({ ...prev, polling: true }));
    try {
      const res = await employeeService.enrollmentStatus(employee._id);
      const d = res?.data || {};
      setEnrollment({
        enrolled: !!d.enrolled,
        fingerCount: Number(d.fingerCount) || 0,
        deviceUserId: d.deviceUserId || employee?.deviceUserId || null,
        lastError: d.error || null,
        polling: false,
      });
    } catch (err) {
      setEnrollment((prev) => ({
        ...prev,
        polling: false,
        lastError: err?.response?.data?.message || err.message || 'Refresh failed',
      }));
    }
  };

  return (
    <Dialog open={open} onClose={closable ? onClose : undefined} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontWeight: 800 }}>Creating employee</DialogTitle>
      <DialogContent>
        <Stepper activeStep={activeStep} alternativeLabel sx={{ mb: 3, mt: 1 }}>
          {STEPS.map((label, idx) => {
            const isLast = idx === STEPS.length - 1;
            const completed = isLast ? finishedEnrollment : activeStep > idx;
            return (
              <Step key={label} completed={completed}>
                <StepLabel error={!!error && idx === activeStep}>{label}</StepLabel>
              </Step>
            );
          })}
        </Stepper>

        <Box sx={{ minHeight: 140, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1.5 }}>
          {!done && !error && (
            <>
              <CircularProgress size={32} />
              <Typography variant="body2" color="text.secondary">{STEPS[activeStep]}…</Typography>
            </>
          )}

          {error && (
            <Alert severity="error" sx={{ width: '100%' }}>{error}</Alert>
          )}

          {done && !error && !biometricOk && (
            <Alert severity="warning" sx={{ width: '100%' }}>
              <strong>Employee created.</strong>
              <br />Device synchronization failed{biometric?.error ? `: ${biometric.error}` : ''}.
              <br />You can retry from the employee details page.
            </Alert>
          )}

          {inEnrollmentPhase && !finishedEnrollment && (
            <Stack spacing={1.5} sx={{ width: '100%' }} alignItems="center">
              <FingerprintIcon color="primary" sx={{ fontSize: 48 }} />
              <Typography variant="subtitle1" fontWeight={700} textAlign="center">
                Please enroll fingerprint on the device
              </Typography>
              <Typography variant="body2" color="text.secondary" textAlign="center">
                Ask <strong>{employee?.fullName || 'the employee'}</strong> to punch their finger on the biometric device now.
              </Typography>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" justifyContent="center" useFlexGap>
                {enrollment.deviceUserId && (
                  <Chip size="small" color="primary" variant="outlined"
                        label={`Device User ID: ${enrollment.deviceUserId}`} />
                )}
                <Chip size="small" color="warning" label={`Templates: ${enrollment.fingerCount}`} />
                <Chip size="small" label={enrollment.polling ? 'Checking device…' : 'Waiting'} />
              </Stack>
              <LinearProgress sx={{ width: '100%' }} />
              {enrollment.lastError && (
                <Typography variant="caption" color="error">{enrollment.lastError}</Typography>
              )}
              <Button size="small" onClick={forceRefresh} disabled={enrollment.polling}>
                Check now
              </Button>
            </Stack>
          )}

          {inEnrollmentPhase && finishedEnrollment && (
            <Stack spacing={1} sx={{ width: '100%' }} alignItems="center">
              <CheckCircleIcon color="success" sx={{ fontSize: 56 }} />
              <Typography variant="h6" fontWeight={800} color="success.main">
                Fingerprint enrolled
              </Typography>
              <Typography variant="body2" color="text.secondary" textAlign="center">
                {employee?.fullName || 'The employee'} is now enrolled on the device
                {enrollment.deviceUserId ? ` as User ID ${enrollment.deviceUserId}` : ''}.
                {enrollment.fingerCount > 0 ? ` (${enrollment.fingerCount} template${enrollment.fingerCount > 1 ? 's' : ''})` : ''}
              </Typography>
            </Stack>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        {inEnrollmentPhase && !finishedEnrollment && (
          <Button onClick={onClose} color="inherit">Skip for now</Button>
        )}
        {(error || (done && !biometricOk) || finishedEnrollment) && (
          <>
            <Button onClick={onClose}>Close</Button>
            {(finishedEnrollment || (done && !error)) && (
              <Button variant="contained" onClick={onGoToList}>Go to Employees</Button>
            )}
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
