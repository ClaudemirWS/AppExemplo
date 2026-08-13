// Cliente do Cloudflare R2 (protocolo S3) para o downloader ESCREVER no bucket.
//
// O R2 e a fonte do acervo online que o PWA consome. Ate agora o upload era manual
// (arrastar no painel). Este modulo permite o download subir zip + manifesto direto,
// e a aba Acervo ler do bucket.
//
// Config SO por process.env (o usuario preenche o .env; a chave NUNCA vive no repo).
// Sem as variaveis, `r2Configurado()` e false e o servidor cai no fallback de disco —
// o downloader continua funcionando local, so nao sobe ao R2.
//
// A escrita e server-side (este processo Node), entao NAO passa por CORS. O CORS do
// bucket segue so com GET, para o PWA (navegador) LER. Nada de PUT no CORS.

import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command
} from "@aws-sdk/client-s3";

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID || "";
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || "";
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || "";
const BUCKET = process.env.R2_BUCKET || "";
// Prefixo (pasta) dentro do bucket. O PWA le de .../offline-conteudos/, entao esse
// e o default — precisa casar com o VITE_PRE_CARGA_URL do PWA.
export const R2_PREFIXO = (process.env.R2_PREFIXO || "offline-conteudos").replace(/^\/+|\/+$/g, "");

// True quando TODAS as variaveis de escrita estao presentes. Enquanto false, o
// servidor usa o disco (fallback) — nada quebra sem credencial.
export function r2Configurado() {
  return Boolean(ACCOUNT_ID && ACCESS_KEY_ID && SECRET_ACCESS_KEY && BUCKET);
}

let clienteCache = null;
function cliente() {
  if (!r2Configurado()) {
    throw new Error("R2 nao configurado (faltam variaveis R2_* no .env).");
  }
  if (!clienteCache) {
    clienteCache = new S3Client({
      region: "auto",
      endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY }
    });
  }
  return clienteCache;
}

// Monta a chave completa no bucket a partir de um nome relativo ao prefixo.
// Ex.: chaveDe("2268.zip") -> "offline-conteudos/2268.zip".
export function chaveDe(nome) {
  return `${R2_PREFIXO}/${String(nome).replace(/^\/+/, "")}`;
}

// PutObject. `bytes` = Uint8Array/Buffer. contentType default zip.
export async function subirObjeto(nome, bytes, contentType = "application/zip") {
  await cliente().send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: chaveDe(nome),
    Body: Buffer.from(bytes),
    ContentType: contentType
  }));
}

export async function apagarObjeto(nome) {
  await cliente().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: chaveDe(nome) }));
}

// Lista os NOMES (relativos ao prefixo) dos objetos no bucket. Pagina ate o fim.
// Ex.: devolve ["2268.zip", "2375.zip", "manifesto.json", ...].
export async function listarNomes() {
  const nomes = [];
  let token;
  do {
    const r = await cliente().send(new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: `${R2_PREFIXO}/`,
      ContinuationToken: token
    }));
    for (const o of r.Contents || []) {
      const rel = o.Key.slice(R2_PREFIXO.length + 1); // tira "offline-conteudos/"
      if (rel) nomes.push(rel);
    }
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return nomes;
}

// GetObject -> Buffer. Lanca se o objeto nao existir.
export async function lerObjeto(nome) {
  const r = await cliente().send(new GetObjectCommand({ Bucket: BUCKET, Key: chaveDe(nome) }));
  // Body e um stream no Node; transformToByteArray e o helper do SDK v3.
  const bytes = await r.Body.transformToByteArray();
  return Buffer.from(bytes);
}
