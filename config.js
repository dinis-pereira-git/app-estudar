// Ligação ao Supabase. Sem URL, a app funciona em modo local
// (matéria lida das pastas do Drive e progresso guardado só neste browser).
// A chave "anon / publishable" é pública por natureza: a segurança vem das regras da base de dados.
window.CONFIG = {
  SUPABASE_URL: '',
  SUPABASE_KEY: '',
  BUCKET: 'conteudos',
};
