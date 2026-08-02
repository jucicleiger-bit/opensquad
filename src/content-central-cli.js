import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import {
  buildApprovalPayload,
  createCentralProject,
  generateContentBatch,
  getCentralPaths,
  regenerateContentDay,
  saveProjectToken,
} from './content-central.js';
import { startContentCentralServer } from './content-central-server.js';

export async function contentCentralCli(subcommand, args, targetDir = process.cwd()) {
  try {
    if (!subcommand || subcommand === 'help') {
      printHelp();
      return { success: true };
    }

    if (subcommand === 'serve') {
      return await runServe(args, targetDir);
    }

    if (subcommand === 'project' && args[0] === 'create') {
      return await runCreateProject(args.slice(1), targetDir);
    }

    if (subcommand === 'token' && args[0] === 'set') {
      return await runSetToken(args.slice(1), targetDir);
    }

    if (subcommand === 'generate') {
      return await runGenerate(args, targetDir);
    }

    if (subcommand === 'regenerate') {
      return await runRegenerate(args, targetDir);
    }

    if (subcommand === 'approval') {
      return await runApproval(args, targetDir);
    }

    console.log(`\n  Comando desconhecido: opensquad content ${subcommand}\n`);
    printHelp();
    return { success: false };
  } catch (err) {
    console.log(`\n  Erro na Central de Conteúdo: ${err.message}\n`);
    return { success: false };
  }
}

async function runCreateProject(args, targetDir) {
  const [projectId, name, handle, approvalEmail, mode = 'semi_automatic'] = args;
  if (!projectId || !name || !handle || !approvalEmail) {
    console.log('\n  Uso: opensquad content project create <id> <nome> <@instagram> <email-aprovacao> [manual|semi_automatic|automatic]\n');
    return { success: false };
  }

  const project = await createCentralProject({ projectId, name, handle, approvalEmail, mode }, targetDir);
  const paths = getCentralPaths(targetDir, project.projectId);
  console.log(`\n  ✅ Projeto criado: ${project.name}`);
  console.log(`  ID: ${project.projectId}`);
  console.log(`  Conta: ${project.instagram.handle}`);
  console.log(`  Modo: ${project.mode}`);
  console.log(`  Pasta: ${paths.projectDir}\n`);
  return { success: true, project };
}

async function runSetToken(args, targetDir) {
  const [projectId, expiresAt, handle] = args;
  if (!projectId || !expiresAt) {
    console.log('\n  Uso: opensquad content token set <project-id> <validade-YYYY-MM-DD> [@instagram]\n');
    console.log('  Dica segura: você pode passar o token por OPENSQUAD_META_TOKEN para não deixar no comando.\n');
    return { success: false };
  }

  const token = process.env.OPENSQUAD_META_TOKEN || await askToken();
  const project = await saveProjectToken(projectId, {
    token,
    expiresAt: normalizeExpiry(expiresAt),
    account: handle ? { handle } : undefined,
  }, targetDir);

  console.log(`\n  ✅ Token registrado para ${project.name}`);
  console.log(`  Token: ${project.token.masked}`);
  console.log(`  Status: ${project.token.status}`);
  console.log(`  Dias restantes: ${project.token.daysRemaining}`);
  console.log('  Observação: o token completo foi salvo só na pasta secrets ignorada pelo git.\n');
  return { success: true, project };
}

async function runGenerate(args, targetDir) {
  const [projectId, days = '7', startDate, channel = 'instagram_feed'] = args;
  if (!projectId) {
    console.log('\n  Uso: opensquad content generate <project-id> [dias] [data-inicial-YYYY-MM-DD] [canal]\n');
    return { success: false };
  }

  const batch = await generateContentBatch(projectId, {
    days: Number(days),
    startDate,
    channel,
  }, targetDir);

  console.log(`\n  ✅ Conteúdos gerados: ${batch.items.length} dia(s)`);
  console.log(`  Projeto: ${batch.projectId}`);
  console.log(`  Lote: ${batch.batchId}`);
  for (const item of batch.items) {
    console.log(`  - Dia ${item.dayNumber}: ${item.contentId} (${item.status})`);
  }
  console.log('\n  Próximo passo: edite/regere um dia específico ou prepare aprovação.\n');
  return { success: true, batch };
}

async function runRegenerate(args, targetDir) {
  const [projectId, contentId, regenerate = 'creative', ...noteParts] = args;
  if (!projectId || !contentId) {
    console.log('\n  Uso: opensquad content regenerate <project-id> <content-id> [creative|caption|all] [observacao]\n');
    return { success: false };
  }

  const note = noteParts.join(' ');
  const content = await regenerateContentDay(projectId, contentId, { regenerate, note }, targetDir);
  console.log(`\n  ✅ Dia regenerado: ${content.contentId}`);
  console.log(`  Status: ${content.status}`);
  console.log(`  Versão imagem: ${content.image.version}`);
  console.log(`  Versão legenda: ${content.caption.version}\n`);
  return { success: true, content };
}

async function runApproval(args, targetDir) {
  const [projectId, contentId] = args;
  if (!projectId || !contentId) {
    console.log('\n  Uso: opensquad content approval <project-id> <content-id>\n');
    return { success: false };
  }

  const payload = await buildApprovalPayload(projectId, contentId, targetDir);
  console.log(`\n  ✅ Aprovação preparada: ${payload.contentId}`);
  console.log(`  Projeto: ${payload.target.projectName}`);
  console.log(`  Conta: ${payload.target.handle}`);
  console.log(`  Arquivo: ${payload.files.json}`);
  console.log('  Frase de aprovação: APROVADO\n');
  return { success: true, payload };
}

async function runServe(args, targetDir) {
  const port = Number(args[0] || 3333);
  const instance = await startContentCentralServer({ targetDir, port, openBrowser: true, enableAiImages: true });
  console.log(`\n  ✅ Central de Conteúdo aberta em: ${instance.url}`);
  console.log('  Use Ctrl+C para parar.\n');

  await new Promise((resolve) => {
    const stop = async () => {
      await instance.close();
      resolve();
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });

  return { success: true };
}

async function askToken() {
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question('\n  Cole o token Meta aqui e pressione Enter: ');
    const token = answer.trim();
    if (!token) throw new Error('Token vazio');
    return token;
  } finally {
    rl.close();
  }
}

function normalizeExpiry(value) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T23:59:59.000Z`;
  return value;
}

function printHelp() {
  console.log(`
  Central de Conteúdo Opensquad — MVP 1

  Comandos:
    opensquad content serve [porta]
    opensquad content project create <id> <nome> <@instagram> <email> [modo]
    opensquad content token set <project-id> <validade-YYYY-MM-DD> [@instagram]
    opensquad content generate <project-id> [dias] [data-inicial-YYYY-MM-DD] [canal]
    opensquad content regenerate <project-id> <content-id> [creative|caption|all] [observacao]
    opensquad content approval <project-id> <content-id>

  Modos:
    manual | semi_automatic | automatic

  Exemplo:
    opensquad content project create meu-projeto "Meu Projeto" @meuperfil juciclei.ger@gmail.com semi_automatic
    opensquad content generate meu-projeto 7 2026-07-20 instagram_feed
  `);
}
