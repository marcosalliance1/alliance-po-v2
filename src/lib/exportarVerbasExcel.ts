import * as XLSX from 'xlsx'

// Mesma estrutura visível na tabela da aba Verbas (categoria > sub categoria >
// item > subtotal > total da categoria), exportada em planilha única.
// Padrão de montagem igual ao já usado em
// src/modules/pre-eventos/utils/exportExcel.ts (XLSX/SheetJS, aoa_to_sheet).

export interface ColunaProjeto {
  id: string
  nome: string
}

export interface LinhaValores {
  valores: Record<string, number>
  total: number
}

export interface SubcategoriaBloco extends LinhaValores {
  nome: string
  itens: (LinhaValores & { item: string })[]
}

export interface CategoriaBloco extends LinhaValores {
  categoria: string
  subcategorias: SubcategoriaBloco[]
}

function montarLinhas(
  blocos: CategoriaBloco[],
  colunas: ColunaProjeto[],
  totalGeral: LinhaValores,
): (string | number)[][] {
  const header = ['Categoria', 'Sub Categoria', 'Item', ...colunas.map(c => c.nome), 'Total']
  const linhas: (string | number)[][] = [header]

  for (const bloco of blocos) {
    linhas.push([bloco.categoria.toUpperCase(), '', '', ...colunas.map(() => ''), ''])
    for (const sub of bloco.subcategorias) {
      for (const it of sub.itens) {
        linhas.push([
          bloco.categoria, sub.nome, it.item,
          ...colunas.map(c => it.valores[c.id] ?? 0),
          it.total,
        ])
      }
      linhas.push([
        bloco.categoria, `Subtotal — ${sub.nome}`, '',
        ...colunas.map(c => sub.valores[c.id] ?? 0),
        sub.total,
      ])
    }
    linhas.push([
      bloco.categoria.toUpperCase(), 'TOTAL', '',
      ...colunas.map(c => bloco.valores[c.id] ?? 0),
      bloco.total,
    ])
  }

  linhas.push([
    'TOTAL GERAL', '', '',
    ...colunas.map(c => totalGeral.valores[c.id] ?? 0),
    totalGeral.total,
  ])

  return linhas
}

export interface ConjuntoExport {
  nomeAba: string
  blocos: CategoriaBloco[]
  totalGeral: LinhaValores
}

// Uma aba por conjunto (ex.: Orçado e Contratado), mesmas colunas de projeto em todas.
export function exportarVerbasExcel(conjuntos: ConjuntoExport[], colunas: ColunaProjeto[]) {
  const wb = XLSX.utils.book_new()
  for (const c of conjuntos) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(montarLinhas(c.blocos, colunas, c.totalGeral)), c.nomeAba)
  }
  XLSX.writeFile(wb, `verbas_${new Date().toISOString().slice(0, 10)}.xlsx`)
}
