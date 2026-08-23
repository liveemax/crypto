"use client";

import { createTheme } from "@mui/material/styles";

export const theme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "#3157d5" },
    background: { default: "#f6f7fb" },
  },
  typography: {
    fontFamily: "var(--font-roboto), Arial, sans-serif",
  },
  shape: { borderRadius: 10 },
});
