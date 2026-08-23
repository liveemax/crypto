"use client";

import { Alert, Button, Stack, TextField } from "@mui/material";
import { useFormState, useFormStatus } from "react-dom";

import { login } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return <Button disabled={pending} type="submit" variant="contained">{pending ? "Вход…" : "Войти"}</Button>;
}

export function LoginForm({ nextPath }: { nextPath?: string }) {
  const [state, action] = useFormState(login, {});

  return (
    <Stack action={action} component="form" spacing={2}>
      {state.error ? <Alert severity="error">{state.error}</Alert> : null}
      <TextField autoComplete="current-password" label="Пароль" name="password" required type="password" />
      <input name="next" type="hidden" value={nextPath ?? ""} />
      <SubmitButton />
    </Stack>
  );
}
