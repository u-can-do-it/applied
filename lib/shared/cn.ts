// Joins class names and resolves Tailwind conflicts (the later class wins): `cn('px-2', active && 'px-4')`.
// components.json's `utils` alias points here. The components `npx shadcn add` writes (shadcn 4.21) import
// the `cn` package directly; this is the same function under the alias.
export { cn } from 'cn';
