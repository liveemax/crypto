import { Container, Typography } from "@mui/material";

import { ProtocolAdmin } from "./protocol-admin";

export default function AdminPage() {
  return (
    <Container maxWidth="xl" sx={{ py: 5 }}>
      <Typography component="h1" variant="h3">Редактор разборов</Typography>
      <Typography color="text.secondary" sx={{ mb: 4 }}>
        Паспорта протоколов и версии методики расчёта
      </Typography>
      <ProtocolAdmin />
    </Container>
  );
}
