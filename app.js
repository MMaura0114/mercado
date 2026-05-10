// Abrir/Configurar IndexedDB
let db;
const DB_NAME = 'MercadinhoDB';
const DB_VERSION = 1;

function abrirDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('produtos')) {
        const storeProd = db.createObjectStore('produtos', { keyPath: 'id', autoIncrement: true });
        storeProd.createIndex('nome', 'nome');
      }
      if (!db.objectStoreNames.contains('vendas')) {
        db.createObjectStore('vendas', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('metadata')) {
        db.createObjectStore('metadata', { keyPath: 'chave' });
      }
    };
  });
}

// Dados iniciais
async function inicializarDados() {
  const tx = db.transaction(['produtos', 'metadata'], 'readwrite');
  const storeProd = tx.objectStore('produtos');
  const storeMeta = tx.objectStore('metadata');
  
  const count = await new Promise(resolve => {
    const req = storeProd.count();
    req.onsuccess = () => resolve(req.result);
  });
  
  if (count === 0) {
    const exemplos = [
      { nome: "Arroz 5kg", preco: 22.50, estoque: 50, codigo: "789100001" },
      { nome: "Feijão 1kg", preco: 8.90, estoque: 30, codigo: "789100002" },
      { nome: "Açúcar 1kg", preco: 4.50, estoque: 40, codigo: "789100003" },
      { nome: "Óleo de Soja 900ml", preco: 6.79, estoque: 25, codigo: "789100004" },
      { nome: "Leite Integral 1L", preco: 4.99, estoque: 60, codigo: "789100005" }
    ];
    for (const prod of exemplos) {
      storeProd.add(prod);
    }
  }
  
  const metaReq = storeMeta.get('ultimaNF');
  if (!metaReq.result) {
    storeMeta.put({ chave: 'ultimaNF', valor: 0 });
  }
  await tx.done;
}

// Funções auxiliares CRUD
async function getProdutos() {
  const tx = db.transaction('produtos', 'readonly');
  const store = tx.objectStore('produtos');
  const produtos = await new Promise(resolve => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
  });
  return produtos;
}

async function salvarProduto(produto) {
  const tx = db.transaction('produtos', 'readwrite');
  const store = tx.objectStore('produtos');
  if (produto.id) {
    await store.put(produto);
  } else {
    await store.add(produto);
  }
  await tx.done;
}

async function excluirProduto(id) {
  const tx = db.transaction('produtos', 'readwrite');
  const store = tx.objectStore('produtos');
  await store.delete(id);
  await tx.done;
}

async function getVendas() {
  const tx = db.transaction('vendas', 'readonly');
  const store = tx.objectStore('vendas');
  const vendas = await new Promise(resolve => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result.sort((a,b) => b.id - a.id));
  });
  return vendas;
}

async function registrarVenda(itens, total) {
  const tx = db.transaction(['vendas', 'produtos', 'metadata'], 'readwrite');
  const vendasStore = tx.objectStore('vendas');
  const produtosStore = tx.objectStore('produtos');
  const metaStore = tx.objectStore('metadata');
  
  // Buscar último número NF
  let ultimaNF = await new Promise(resolve => {
    const req = metaStore.get('ultimaNF');
    req.onsuccess = () => resolve(req.result ? req.result.valor : 0);
  });
  const novaNF = ultimaNF + 1;
  await metaStore.put({ chave: 'ultimaNF', valor: novaNF });
  
  // Atualizar estoque
  for (const item of itens) {
    const prod = await new Promise(resolve => {
      const req = produtosStore.get(item.id);
      req.onsuccess = () => resolve(req.result);
    });
    if (!prod || prod.estoque < item.quantidade) {
      throw new Error(`Estoque insuficiente para ${item.nome}`);
    }
    prod.estoque -= item.quantidade;
    await produtosStore.put(prod);
  }
  
  // Salvar venda
  const venda = {
    data: new Date().toISOString(),
    total,
    itens: JSON.stringify(itens),
    nf_numero: novaNF
  };
  const vendaId = await new Promise(resolve => {
    const req = vendasStore.add(venda);
    req.onsuccess = () => resolve(req.result);
  });
  await tx.done;
  return { vendaId, nf_numero: novaNF };
}

async function getVendaById(id) {
  const tx = db.transaction('vendas', 'readonly');
  const store = tx.objectStore('vendas');
  const venda = await new Promise(resolve => {
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result);
  });
  return venda;
}

// ---------- UI ----------
let produtosAtuais = [];
let carrinho = [];

async function carregarDados() {
  produtosAtuais = await getProdutos();
  renderVitrine();
  renderProdutosPDV();
  renderTabelaProdutos();
  renderHistorico();
}

function renderVitrine() {
  const container = document.getElementById('listaProdutosVitrine');
  if (!produtosAtuais.length) { container.innerHTML = '<div class="col-12 alert alert-info">Nenhum produto cadastrado.</div>'; return; }
  container.innerHTML = produtosAtuais.map(p => `
    <div class="col-md-3 mb-3"><div class="card h-100"><div class="card-body">
      <h5 class="card-title">${p.nome}</h5>
      <p class="card-text">Preço: <strong>R$ ${p.preco.toFixed(2)}</strong><br>Código: ${p.codigo || '-'}</p>
      <p class="text-muted">Estoque: ${p.estoque}</p>
    </div></div></div>
  `).join('');
}

function renderProdutosPDV() {
  const container = document.getElementById('listaProdutosPDV');
  container.innerHTML = produtosAtuais.map(p => `
    <div class="mb-2 d-flex justify-content-between align-items-center">
      <span><strong>${p.nome}</strong> - R$ ${p.preco.toFixed(2)} (${p.estoque} unid.)</span>
      <button class="btn btn-sm btn-outline-success" onclick="adicionarAoCarrinho(${p.id}, '${p.nome.replace(/'/g, "\\'")}', ${p.preco})">+</button>
    </div>
  `).join('');
}

window.adicionarAoCarrinho = function(id, nome, preco) {
  const item = carrinho.find(i => i.id === id);
  if (item) item.quantidade++;
  else carrinho.push({ id, nome, preco, quantidade: 1 });
  renderCarrinho();
}

function renderCarrinho() {
  const container = document.getElementById('carrinhoItens');
  if (!carrinho.length) { container.innerHTML = '<p class="text-muted">Carrinho vazio</p>'; document.getElementById('totalCarrinho').innerText = '0.00'; return; }
  let total = 0;
  container.innerHTML = '<ul class="list-group">' + carrinho.map((item, idx) => {
    total += item.preco * item.quantidade;
    return `<li class="list-group-item d-flex justify-content-between">
      <span>${item.nome} x ${item.quantidade}</span>
      <span>R$ ${(item.preco * item.quantidade).toFixed(2)} 
        <button class="btn btn-sm btn-warning" onclick="alterarQuantidade(${idx}, -1)">-</button>
        <button class="btn btn-sm btn-success" onclick="alterarQuantidade(${idx}, 1)">+</button>
        <button class="btn btn-sm btn-danger" onclick="removerItem(${idx})">🗑️</button>
      </span>
    </li>`;
  }).join('') + '</ul>';
  document.getElementById('totalCarrinho').innerText = total.toFixed(2);
}

window.alterarQuantidade = function(idx, delta) {
  const novaQtd = carrinho[idx].quantidade + delta;
  if (novaQtd <= 0) carrinho.splice(idx, 1);
  else carrinho[idx].quantidade = novaQtd;
  renderCarrinho();
}

window.removerItem = function(idx) {
  carrinho.splice(idx, 1);
  renderCarrinho();
}

document.getElementById('finalizarVendaBtn').addEventListener('click', async () => {
  if (!carrinho.length) return alert('Adicione itens ao carrinho.');
  const total = parseFloat(document.getElementById('totalCarrinho').innerText);
  try {
    const result = await registrarVenda(carrinho, total);
    alert(`Venda concluída! Nota Fiscal nº ${result.nf_numero}`);
    carrinho = [];
    renderCarrinho();
    await carregarDados();
    gerarComprovante(result.vendaId, result.nf_numero);
  } catch (err) {
    alert('Erro: ' + err.message);
  }
});

async function gerarComprovante(vendaId, nfNumero) {
  const venda = await getVendaById(vendaId);
  const itens = JSON.parse(venda.itens);
  let html = `<!DOCTYPE html><html><head><title>Nota Fiscal ${nfNumero}</title><style>body{font-family: monospace; margin:20px;} table{border-collapse:collapse;} td,th{border:1px solid #000; padding:6px;}</style></head><body><h2>MERCADINHO DO BAIRRO</h2><p>Nota Fiscal Nº ${nfNumero}<br>Data: ${new Date(venda.data).toLocaleString()}</p><table width="100%"><tr><th>Item</th><th>Qtd</th><th>Preço</th><th>Subtotal</th></tr>`;
  let total = 0;
  itens.forEach(item => {
    const subtotal = item.preco * item.quantidade;
    total += subtotal;
    html += `<tr><td>${item.nome}</td><td>${item.quantidade}</td><td>R$ ${item.preco.toFixed(2)}</td><td>R$ ${subtotal.toFixed(2)}</td></tr>`;
  });
  html += `<tr><td colspan="3"><strong>Total</strong></td><td><strong>R$ ${total.toFixed(2)}</strong></td></tr></table><p>Obrigado pela compra!</p><button onclick="window.print()">Imprimir / Salvar PDF</button></body></html>`;
  const win = window.open();
  win.document.write(html);
  win.document.close();
}

function renderTabelaProdutos() {
  const tbody = document.querySelector('#tabelaProdutos tbody');
  tbody.innerHTML = produtosAtuais.map(p => `
    <tr><td>${p.id}</td><td>${p.nome}</td><td>R$ ${p.preco.toFixed(2)}</td><td>${p.estoque}</td><td>${p.codigo || '-'}</td><td><button class="btn btn-sm btn-warning" onclick="editarProduto(${p.id})">✏️</button> <button class="btn btn-sm btn-danger" onclick="excluirProdutoHandler(${p.id})">🗑️</button></td></tr>
  `).join('');
}

window.editarProduto = function(id) {
  const prod = produtosAtuais.find(p => p.id === id);
  if (prod) {
    document.getElementById('produtoId').value = prod.id;
    document.getElementById('produtoNome').value = prod.nome;
    document.getElementById('produtoPreco').value = prod.preco;
    document.getElementById('produtoEstoque').value = prod.estoque;
    document.getElementById('produtoCodigo').value = prod.codigo || '';
    new bootstrap.Modal(document.getElementById('modalProduto')).show();
  }
}

window.excluirProdutoHandler = async function(id) {
  if (confirm('Tem certeza?')) {
    await excluirProduto(id);
    await carregarDados();
  }
}

document.getElementById('salvarProdutoBtn').addEventListener('click', async () => {
  const id = document.getElementById('produtoId').value;
  const nome = document.getElementById('produtoNome').value;
  const preco = parseFloat(document.getElementById('produtoPreco').value);
  const estoque = parseInt(document.getElementById('produtoEstoque').value);
  const codigo = document.getElementById('produtoCodigo').value;
  if (!nome || isNaN(preco) || isNaN(estoque)) return alert('Preencha todos os campos corretamente.');
  const produto = { nome, preco, estoque, codigo };
  if (id) produto.id = parseInt(id);
  await salvarProduto(produto);
  bootstrap.Modal.getInstance(document.getElementById('modalProduto')).hide();
  await carregarDados();
  document.getElementById('produtoId').value = '';
  document.getElementById('produtoNome').value = '';
  document.getElementById('produtoPreco').value = '';
  document.getElementById('produtoEstoque').value = '';
  document.getElementById('produtoCodigo').value = '';
});

async function renderHistorico() {
  const vendas = await getVendas();
  const tbody = document.querySelector('#tabelaVendas tbody');
  tbody.innerHTML = vendas.map(v => `
    <tr><td>${v.nf_numero}</td><td>${new Date(v.data).toLocaleString()}</td><td>R$ ${v.total.toFixed(2)}</td><td><button class="btn btn-sm btn-info" onclick="reimprimirNota(${v.id})">🖨️ Reimprimir</button></td></tr>
  `).join('');
}

window.reimprimirNota = async function(vendaId) {
  const venda = await getVendaById(vendaId);
  const itens = JSON.parse(venda.itens);
  let html = `<!DOCTYPE html><html><head><title>Reimpressão NF ${venda.nf_numero}</title><style>body{font-family: monospace;} table{border-collapse:collapse;} td,th{border:1px solid #000; padding:6px;}</style></head><body><h2>MERCADINHO DO BAIRRO</h2><p>NOTA FISCAL Nº ${venda.nf_numero}<br>Data: ${new Date(venda.data).toLocaleString()}</p><table width="100%"><tr><th>Item</th><th>Qtd</th><th>Preço</th><th>Subtotal</th></tr>`;
  let total = 0;
  itens.forEach(item => {
    const subtotal = item.preco * item.quantidade;
    total += subtotal;
    html += `<tr><td>${item.nome}</td><td>${item.quantidade}</td><td>R$ ${item.preco.toFixed(2)}</td><td>R$ ${subtotal.toFixed(2)}</td></tr>`;
  });
  html += `<tr><td colspan="3"><strong>Total</strong></td><td><strong>R$ ${total.toFixed(2)}</strong></td></tr></table><button onclick="window.print()">Imprimir</button></body></html>`;
  const win = window.open();
  win.document.write(html);
  win.document.close();
}

// Atualizar status online/offline
function atualizarStatus() {
  const status = document.getElementById('onlineStatus');
  if (navigator.onLine) {
    status.innerText = 'Online';
    status.classList.remove('bg-secondary');
    status.classList.add('bg-success');
  } else {
    status.innerText = 'Offline (dados locais)';
    status.classList.remove('bg-success');
    status.classList.add('bg-secondary');
  }
}
window.addEventListener('online', atualizarStatus);
window.addEventListener('offline', atualizarStatus);

// Inicialização
(async function() {
  await abrirDB();
  await inicializarDados();
  await carregarDados();
  atualizarStatus();
})();