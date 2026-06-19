import React, { useMemo } from 'react';
import { ThemeProvider, createTheme, CssBaseline } from '@mui/material';
import { useSelector } from 'react-redux';

const tokens = (mode) => ({
  palette: {
    mode,
    primary: { main: '#5b6ef5' },
    secondary: { main: '#a855f7' },
    success: { main: '#1aab50' },
    warning: { main: '#f5a524' },
    error: { main: '#ef4444' },
    info: { main: '#06b6d4' },
    background:
      mode === 'light'
        ? { default: '#f5f7fb', paper: '#ffffff' }
        : { default: '#0b1020', paper: '#121833' },
    text:
      mode === 'light'
        ? { primary: '#14171f', secondary: '#5b6577' }
        : { primary: '#e6e8f2', secondary: '#9aa3b9' },
  },
  shape: { borderRadius: 14 },
  typography: {
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, system-ui, sans-serif",
    h1: { fontWeight: 800, letterSpacing: -0.5 },
    h2: { fontWeight: 800, letterSpacing: -0.5 },
    h3: { fontWeight: 700, letterSpacing: -0.3 },
    h4: { fontWeight: 700, letterSpacing: -0.2 },
    h5: { fontWeight: 700 },
    h6: { fontWeight: 600 },
    button: { textTransform: 'none', fontWeight: 600, letterSpacing: 0.2 },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        '*, *::before, *::after': {
          transition: 'background-color .2s ease, color .2s ease, border-color .2s ease',
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 18,
          boxShadow:
            mode === 'light'
              ? '0 8px 30px rgba(20,23,31,0.06)'
              : '0 8px 30px rgba(0,0,0,0.35)',
          transition: 'transform .25s ease, box-shadow .25s ease, border-color .25s ease',
          border: `1px solid ${mode === 'light' ? 'rgba(20,23,31,0.05)' : 'rgba(255,255,255,0.05)'}`,
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          paddingInline: 18,
          transition: 'transform .18s ease, box-shadow .18s ease, background-color .2s ease',
          '&:hover': { transform: 'translateY(-1px)' },
          '&:active': { transform: 'translateY(0)' },
        },
        contained: {
          boxShadow: 'none',
          '&:hover': {
            boxShadow:
              mode === 'light'
                ? '0 8px 20px rgba(91,110,245,0.28)'
                : '0 8px 20px rgba(91,110,245,0.45)',
          },
        },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: {
          transition: 'transform .18s ease, background-color .2s ease',
          '&:hover': { transform: 'scale(1.08)' },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          fontWeight: 600,
          transition: 'transform .15s ease, box-shadow .15s ease',
          '&:hover': { transform: 'translateY(-1px)' },
        },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          transition: 'background-color .2s ease, transform .15s ease, padding-left .2s ease',
        },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: { transition: 'color .2s ease, background-color .2s ease' },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: {
          transition: 'background-color .15s ease',
          '&:hover': {
            backgroundColor:
              mode === 'light' ? 'rgba(91,110,245,0.04)' : 'rgba(91,110,245,0.10)',
          },
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          transition: 'box-shadow .2s ease, border-color .2s ease',
          '&.Mui-focused': {
            boxShadow:
              mode === 'light'
                ? '0 0 0 4px rgba(91,110,245,0.15)'
                : '0 0 0 4px rgba(91,110,245,0.25)',
          },
        },
      },
    },
    MuiAvatar: {
      styleOverrides: {
        root: { transition: 'transform .2s ease, box-shadow .2s ease' },
      },
    },
    MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          fontSize: 12,
          fontWeight: 500,
          padding: '6px 10px',
          borderRadius: 8,
          backgroundColor: mode === 'light' ? 'rgba(20,23,31,0.92)' : 'rgba(11,16,32,0.95)',
        },
      },
    },
  },
});

export default function ThemeProviderWrapper({ children }) {
  const mode = useSelector((s) => s.ui.themeMode);
  const theme = useMemo(() => createTheme(tokens(mode)), [mode]);
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {children}
    </ThemeProvider>
  );
}
