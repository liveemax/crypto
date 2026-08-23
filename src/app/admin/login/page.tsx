import { Container, Paper, Typography } from "@mui/material";

import { LoginForm } from "./login-form";

export default function LoginPage({ searchParams }: { searchParams: { next?: string } }) {
  return (
    <Container maxWidth="xs" sx={{ py: 10 }}>
      <Paper elevation={2} sx={{ p: 4 }}>
        <Typography component="h1" sx={{ mb: 3 }} variant="h4">Вход в редактор</Typography>
        <LoginForm nextPath={searchParams.next} />
      </Paper>
    </Container>
  );
}
