import { useState } from 'react';
import {
  Box, Drawer, AppBar, Toolbar, Typography, IconButton, Avatar, Menu, MenuItem, Divider, Tooltip, Badge, useMediaQuery, useTheme,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import LightModeIcon from '@mui/icons-material/LightMode';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import NotificationsIcon from '@mui/icons-material/Notifications';
import LogoutIcon from '@mui/icons-material/Logout';
import LockResetIcon from '@mui/icons-material/LockReset';
import PersonIcon from '@mui/icons-material/Person';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Sidebar from './Sidebar';
import { logout } from '../../features/auth/authSlice';
import { toggleSidebar, toggleTheme } from '../../features/ui/uiSlice';
import { authService, notificationService } from '../../services';
import { initials, asset } from '../../lib/format';

const DRAWER_WIDTH = 260;

export default function DashboardLayout() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const user = useSelector((s) => s.auth.user);
  const sidebarOpen = useSelector((s) => s.ui.sidebarOpen);
  const themeMode = useSelector((s) => s.ui.themeMode);
  const refreshToken = useSelector((s) => s.auth.refreshToken);

  const [mobileOpen, setMobileOpen] = useState(false);
  const [anchor, setAnchor] = useState(null);

  const qc = useQueryClient();

  const { data: notifData } = useQuery({
    queryKey: ['notifications', user?._id],
    queryFn: () => notificationService.list(),
    enabled: !!user?._id,
    refetchOnWindowFocus: true,
    refetchInterval: 15_000,
  });
  const unread = notifData?.data?.unread || 0;

  const handleLogout = async () => {
    try { await authService.logout(refreshToken); } catch {}
    qc.clear();
    dispatch(logout());
    navigate('/login');
  };

  const drawer = <Sidebar onNavigate={() => isMobile && setMobileOpen(false)} />;

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <AppBar
        position="fixed"
        elevation={0}
        sx={{
          zIndex: theme.zIndex.drawer + 1,
          backdropFilter: 'blur(14px)',
          backgroundColor: theme.palette.mode === 'light' ? 'rgba(255,255,255,0.78)' : 'rgba(11,16,32,0.7)',
          color: 'text.primary',
          borderBottom: `1px solid ${theme.palette.divider}`,
        }}
      >
        <Toolbar sx={{ gap: 1 }}>
          <IconButton
            onClick={() => (isMobile ? setMobileOpen(!mobileOpen) : dispatch(toggleSidebar()))}
            edge="start"
          >
            <MenuIcon />
          </IconButton>
          <Typography variant="h6" sx={{ fontWeight: 800, letterSpacing: 0.4 }}>
            <span
              style={{
                background: 'linear-gradient(135deg,#5b6ef5,#a855f7)',
                WebkitBackgroundClip: 'text',
                color: 'transparent',
                cursor: 'pointer',
                display: 'inline-block',
                transition: 'transform .2s ease, filter .2s ease',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.filter = 'brightness(1.1)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.filter = 'none'; }}
              onClick={() => navigate('/')}
            >
              TLA HRMS
            </span>
          </Typography>
          <Box sx={{ flex: 1 }} />
          <Tooltip title="Toggle theme">
            <IconButton onClick={() => dispatch(toggleTheme())}>
              {themeMode === 'light' ? <DarkModeIcon /> : <LightModeIcon />}
            </IconButton>
          </Tooltip>
          <Tooltip title="Notifications">
            <IconButton onClick={() => navigate('/notifications')}>
              <Badge badgeContent={unread} color="error">
                <NotificationsIcon />
              </Badge>
            </IconButton>
          </Tooltip>
          <Tooltip title="Account">
            <IconButton onClick={(e) => setAnchor(e.currentTarget)}>
              <Avatar
                src={asset(user?.profilePicture)}
                sx={{ width: 36, height: 36, bgcolor: 'primary.main', fontSize: 14 }}
              >
                {initials(user?.fullName)}
              </Avatar>
            </IconButton>
          </Tooltip>
          <Menu open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)}>
            <MenuItem disabled>
              <Box>
                <Typography variant="body2" fontWeight={700}>{user?.fullName}</Typography>
                <Typography variant="caption" color="text.secondary">{user?.email}</Typography>
              </Box>
            </MenuItem>
            <Divider />
            <MenuItem onClick={() => { setAnchor(null); navigate('/profile'); }}>
              <PersonIcon fontSize="small" style={{ marginRight: 8 }} /> My Profile
            </MenuItem>
            <MenuItem onClick={() => { setAnchor(null); navigate('/change-password'); }}>
              <LockResetIcon fontSize="small" style={{ marginRight: 8 }} /> Change password
            </MenuItem>
            <MenuItem onClick={handleLogout}>
              <LogoutIcon fontSize="small" style={{ marginRight: 8 }} /> Logout
            </MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>

      {/* Sidebar */}
      {isMobile ? (
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{ '& .MuiDrawer-paper': { width: DRAWER_WIDTH } }}
        >
          <Toolbar />
          {drawer}
        </Drawer>
      ) : (
        <Drawer
          variant="permanent"
          open={sidebarOpen}
          sx={{
            width: sidebarOpen ? DRAWER_WIDTH : 78,
            flexShrink: 0,
            '& .MuiDrawer-paper': {
              width: sidebarOpen ? DRAWER_WIDTH : 78,
              boxSizing: 'border-box',
              borderRight: `1px solid ${theme.palette.divider}`,
              transition: 'width .25s ease',
              overflowX: 'hidden',
            },
          }}
        >
          <Toolbar />
          {drawer}
        </Drawer>
      )}

      <Box component="main" sx={{ flexGrow: 1, p: { xs: 2, md: 3 }, mt: 8, maxWidth: '100%' }}>
        <Box key={location.pathname} className="fade-in-up"><Outlet /></Box>
      </Box>
    </Box>
  );
}
