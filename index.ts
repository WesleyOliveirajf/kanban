// Entrada Express para a Vercel (zero-config). Estáticos saem de public/.
import { bootstrap } from "./server/src/bootstrap.js";

const { app } = await bootstrap({ serveWeb: false });
export default app;
