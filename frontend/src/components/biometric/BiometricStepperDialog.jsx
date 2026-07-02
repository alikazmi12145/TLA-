import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Stepper, Step, StepLabel, Box, Typography, Alert, CircularProgress } from '@mui/material';

const STEPS = [
  'Saving employee…',
  'Connecting device…',
  'Creating user…',
  'Updating database…',
  'Completed',
];

/**
 * Modal that walks the admin through the multi-step create-employee flow.
 * Parent owns the stepper state (activeStep, error, result) and calls the
 * three callbacks on the buttons.
 *
 * Props:
 *   open        boolean
 *   activeStep  number  (0..STEPS.length-1)
 *   error       string | null
 *   result      { biometric?: { ok, error? } } | null
 *   onClose     ()
 *   onGoToList  ()   — after success
 */
export default function BiometricStepperDialog({ open, activeStep, error, result, onClose, onGoToList }) {
  const done = activeStep >= STEPS.length - 1;
  const biometricOk = result?.biometric?.ok;

  return (
    <Dialog open={open} onClose={done || error ? onClose : undefined} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontWeight: 800 }}>Creating employee</DialogTitle>
      <DialogContent>
        <Stepper activeStep={activeStep} alternativeLabel sx={{ mb: 3, mt: 1 }}>
          {STEPS.map((label, idx) => (
            <Step key={label} completed={activeStep > idx || (done && idx === STEPS.length - 1 && !error)}>
              <StepLabel error={error && idx === activeStep}>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>

        <Box sx={{ minHeight: 90, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1.5 }}>
          {!done && !error && (
            <>
              <CircularProgress size={32} />
              <Typography variant="body2" color="text.secondary">{STEPS[activeStep]}</Typography>
            </>
          )}
          {error && (
            <Alert severity="error" sx={{ width: '100%' }}>
              {error}
            </Alert>
          )}
          {done && !error && (
            <Alert severity={biometricOk ? 'success' : 'warning'} sx={{ width: '100%' }}>
              {biometricOk ? (
                <>
                  <strong>Employee created successfully.</strong>
                  <br />User synchronized to device. Please enroll fingerprint on the biometric device.
                </>
              ) : (
                <>
                  <strong>Employee created.</strong>
                  <br />Device synchronization failed{result?.biometric?.error ? `: ${result.biometric.error}` : ''}.
                  <br />You can retry from the employee details page.
                </>
              )}
            </Alert>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        {(done || error) && (
          <>
            <Button onClick={onClose}>Close</Button>
            {done && !error && (
              <Button variant="contained" onClick={onGoToList}>Go to Employees</Button>
            )}
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
