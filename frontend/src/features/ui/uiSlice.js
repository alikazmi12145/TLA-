import { createSlice } from '@reduxjs/toolkit';

const initialMode = localStorage.getItem('tla_theme') || 'light';
const initialSidebar = JSON.parse(localStorage.getItem('tla_sidebar') || 'true');

const slice = createSlice({
  name: 'ui',
  initialState: {
    themeMode: initialMode,
    sidebarOpen: initialSidebar,
  },
  reducers: {
    toggleTheme: (state) => {
      state.themeMode = state.themeMode === 'light' ? 'dark' : 'light';
      localStorage.setItem('tla_theme', state.themeMode);
    },
    setTheme: (state, action) => {
      state.themeMode = action.payload;
      localStorage.setItem('tla_theme', state.themeMode);
    },
    toggleSidebar: (state) => {
      state.sidebarOpen = !state.sidebarOpen;
      localStorage.setItem('tla_sidebar', JSON.stringify(state.sidebarOpen));
    },
  },
});

export const { toggleTheme, setTheme, toggleSidebar } = slice.actions;
export default slice.reducer;
