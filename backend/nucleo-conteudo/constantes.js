export const HOST_CONTEUDOS = "conteudos.educandus.com.br";
export const PASTA_CONTEUDOS_OFFLINE = "offline-conteudos";
export const PASTA_VENDOR_OFFLINE = "offline-vendor";
export const SERVIDOR_CONTEUDO_LOCAL_PADRAO = "http://127.0.0.1:8765/";
export const LIMITE_RECURSOS = 1200;
export const LIMITE_BYTES = 600 * 1024 * 1024;
export const LIMITE_BLOB_MIDIA_BYTES = 5 * 1024 * 1024;
// No PWA vinha de `import.meta.env.VITE_BLOB_MIDIAS_GRANDES`. Em Node lemos de
// process.env com o mesmo default (ligado, salvo "false" explicito).
export const USAR_BLOB_MIDIAS_GRANDES = process.env.ACERVO_BLOB_MIDIAS_GRANDES !== "false";
export const CONCORRENCIA_LISTAGEM = 4;
export const CONCORRENCIA_DOWNLOAD = 2;
export const CONCORRENCIA_ESCRITA = 2;
// Mais tentativas que o PWA (era 3): o downloader quer COMPLETAR a aula, nao
// desistir rapido. Uma falha transitoria de rede no publicador nao deve abandonar
// o recurso. Configuravel por env.
export const TENTATIVAS_DOWNLOAD = Number(process.env.ACERVO_TENTATIVAS || 6);
export const ATRASO_RETRY_MS = Number(process.env.ACERVO_ATRASO_RETRY_MS || 800);
export const EXTENSOES_TEXTO = /\.(?:html?|css|js|mjs|json|xml|svg|txt|appcache|webmanifest)(?:[?#].*)?$/i;
export const EXTENSOES_RECURSO =
  /\.(?:html?|png|jpe?g|gif|webp|svg|json|js|mjs|css|xml|mp3|m4a|ogg|wav|webm|mp4|wasm|ttf|otf|woff2?|appcache|webmanifest|glb|gltf|bin)(?:[?#].*)?$/i;
// `sons/` (em portugues) e das aulas Animate da Educandus: os mp3 sao referenciados
// DINAMICAMENTE no JS ("sons/"+nome+".mp3"), que o crawler nao extrai — so sao pegos
// espelhando a pasta por listagem. Sem `sons/` aqui a aula baixava SEM AUDIO.
export const DIRETORIOS_COMUNS = ["assets/", "css/", "js/", "xml/", "libs/", "images/", "media/", "icons/", "sounds/", "sons/"];
// Uniao dos dois conjuntos, para o espelho do publicador nao precisar saber o
// formato antes de varrer. Listar um diretorio inexistente custa um 404.
export const DIRETORIOS_ESPELHO = [
  "assets/", "css/", "js/", "xml/", "libs/",
  "images/", "media/", "icons/", "sounds/", "sons/", "scripts/", "videos/"
];
// `images/` e `media/` sao do Construct 2; `icons/`, `scripts/`, `sounds/` e
// `videos/`, do 3. A lista serve aos dois: um diretorio que nao existe apenas nao
// devolve nada na listagem.
export const DIRETORIOS_CONSTRUCT = ["icons/", "images/", "media/", "scripts/", "sounds/", "videos/"];
export const FORMATOS_PUBLICADOR_OFFLINE = new Set([
  "construct2",
  "construct3",
  "html-modelo-classico",
  "html-moderno",
  "animate-autonomo",
  "html-educandus"
]);
export const HOSTS_VENDOR = new Set([
  "classes.educandus.com.br",
  "cdnjs.cloudflare.com",
  "code.createjs.com",
  "cdn.jsdelivr.net",
  "code.jquery.com",
  "cdn.skypack.dev",
  "netdna.bootstrapcdn.com"
]);
export const VENDOR_THREE_0129 = `${PASTA_VENDOR_OFFLINE}/three/0.129.0`;
export const LOG_DOWNLOAD = "[AVA_DOWNLOAD]";
export const CODIGO_DOWNLOAD_CANCELADO = "DOWNLOAD_CANCELADO";
export const MENSAGEM_AULA_INDISPONIVEL_OFFLINE = "Essa aula ainda não está disponível offline.";
// Conteudos que o downloader recusa CEDO em baixarPacoteConteudo, com motivo claro,
// em vez de tentar baixar paginas que vao falhar (evita erro tardio/generico e loop).
//   - "NAO" = Flash/AS2 legado: paginas .swf, so abrem online (via Puffin no PWA).
//   - "VALBERTO" = interface propria; mantido como estava (o downloader nunca baixou
//     uma VALBERTO com sucesso — 14/14 do acervo sao SIM). Se um dia formos habilitar
//     download de VALBERTO, e uma investigacao a parte, nao um efeito colateral daqui.
export const CONVERTIDOS_AULA_INDISPONIVEIS_OFFLINE = new Set(["VALBERTO", "NAO"]);
