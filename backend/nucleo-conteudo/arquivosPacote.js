// PONTE DE PERSISTENCIA.
//
// No PWA este arquivo era a implementacao da Cache API (o unico modulo
// inerentemente do navegador). Aqui ele apenas reexporta o adaptador de disco,
// para que cacheRecursos.js e pacoteConteudo.js — que importam "./arquivosPacote.js"
// — gravem em `acervo/` sem nenhuma alteracao neles.
//
// Toda a implementacao real vive em adaptadores/fsAcervo.js. Trocar de meio
// (disco, S3, o que for) e trocar so aquele arquivo.

export {
  removerDiretorioSeExistir,
  arquivoExiste,
  escreverArquivoTexto,
  escreverArquivoBinario,
  escreverArquivoBlob,
  renomearDiretorioPacote,
  lerArquivoTexto,
  lerArquivoBlob,
  listarSubdiretoriosCache,
  obterUrlArquivoLocal
} from "../adaptadores/fsAcervo.js";
