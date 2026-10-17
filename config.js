// Ligação ao Supabase. Sem URL, a app funciona em modo local
// (matéria lida das pastas do Drive e progresso guardado só neste browser).
// A chave "anon / publishable" é pública por natureza: a segurança vem das regras da base de dados.
window.CONFIG = {
  SUPABASE_URL: 'https://dndaqyxwvwrflmvnhxhk.supabase.co',
  SUPABASE_KEY: 'sb_publishable_lldc3n2lDmZmC18q8r_Aig_n_fiNgFx',
  BUCKET: 'conteudos',
};
