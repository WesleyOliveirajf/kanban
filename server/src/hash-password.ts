// Uso: printf %s "$SENHA" | npm run -s hash-password   (a senha vem do stdin, não do histórico do shell)
import { hashPassword } from "./auth/password.js";

let input = "";
for await (const chunk of process.stdin) input += chunk;
const password = input.replace(/\r?\n$/, "");
if (password.length < 6) {
  console.error("A senha precisa ter ao menos 6 caracteres.");
  process.exit(1);
}
if (password.length < 10 || /^\d+$/.test(password))
  console.error("Aviso: senha curta ou só com números é fácil de adivinhar. Em produção (internet) prefira uma senha longa.");
console.log(await hashPassword(password));
