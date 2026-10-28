-- Grupos salvos da aba Verbas: conjuntos de itens com nome (ex.: "Mobiliário", "Palco", "Floral")
-- que o time reaplica como filtro. Compartilhados: todos que abrem a Verbas veem os mesmos grupos.
-- `itens` = lista de {categoria, sub, item} — a mesma chave que a aba usa para juntar o item entre projetos.
-- Leitura: anon + authenticated (o time de produção pode abrir a aba com o acesso de leitura).
-- Escrita (criar, editar, excluir): só usuário autenticado (login do PO V2).
-- Tabela nova e independente: não toca em nenhuma tabela existente.
-- Rollback: drop table verbas_grupos;
create table if not exists verbas_grupos (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null check (length(btrim(nome)) > 0),
  itens         jsonb not null default '[]'::jsonb,
  criado_por    text,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create unique index if not exists verbas_grupos_nome_unico on verbas_grupos (lower(btrim(nome)));

comment on table verbas_grupos is 'Grupos de itens salvos na aba Verbas do PO V2 (filtro reutilizável, compartilhado).';

alter table verbas_grupos enable row level security;

grant select on verbas_grupos to anon;
grant select, insert, update, delete on verbas_grupos to authenticated;
grant select, insert, update, delete on verbas_grupos to service_role;

create policy "leitura_verbas_grupos" on verbas_grupos
  for select to anon, authenticated using (true);
create policy "escrita_verbas_grupos" on verbas_grupos
  for insert to authenticated with check (true);
create policy "edicao_verbas_grupos" on verbas_grupos
  for update to authenticated using (true) with check (true);
create policy "exclusao_verbas_grupos" on verbas_grupos
  for delete to authenticated using (true);
