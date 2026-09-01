(() => {
  'use strict';

  const DEFAULT_SETTINGS = { timezone: 'Europe/Paris', dateFormat: 'DD/MM/YYYY', timeFormat: 'HH:mm' };
  const state = { mode: null, file: null, model: null, validation: null, simulation: null, access: 'none' };
  const $ = id => document.getElementById(id);
  const els = Object.fromEntries([
    'accessBadge','chooseXlsx','chooseJson','xlsxPath','jsonPath','xlsxInput','xlsxFileName','xlsxDrop','analyzeXlsxBtn',
    'jsonInput','jsonFileName','jsonText','formatJsonBtn','analyzeJsonBtn','analysisMessage','previewSection','sourceLabel',
    'settingsPreview','metrics','tablesPreview','modelState','simulateBtn','resetBtn','simulationSection','simulationSummary',
    'simulationDetails','warningBox','buildBtn','resimulateBtn','progressSection','progressText','progressBar','buildLog',
    'exportXlsxBtn','exportJsonBtn','xlsxPrompt','jsonPrompt'
  ].map(id => [id, $(id)]));

  const IDENT = /^[A-Za-z][A-Za-z0-9_]*$/;
  const SIMPLE_TYPES = new Set(['Text','Numeric','Int','Bool','Date','Choice','ChoiceList','Attachments','Any']);

  const text = v => v == null ? '' : String(v).trim();
  const esc = (v='') => String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const show = (el, yes=true) => el.classList.toggle('hidden', !yes);
  const notice = (msg, kind='') => {
    els.analysisMessage.className = `notice ${kind}`.trim();
    els.analysisMessage.textContent = msg;
    show(els.analysisMessage, true);
    els.analysisMessage.scrollIntoView({behavior:'smooth',block:'nearest'});
  };
  const refTarget = t => (/^(?:Ref|RefList):(.+)$/.exec(t)||[])[1] || null;
  const normalizeSettings = s => ({
    timezone: text(s?.timezone) || DEFAULT_SETTINGS.timezone,
    dateFormat: text(s?.dateFormat) || DEFAULT_SETTINGS.dateFormat,
    timeFormat: text(s?.timeFormat) || DEFAULT_SETTINGS.timeFormat
  });
  const normalizeType = (v, settings) => {
    const t = text(v);
    if (t === 'DateTime') return `DateTime:${settings.timezone}`;
    return t;
  };
  const validType = t => SIMPLE_TYPES.has(t) || /^DateTime:[^\s]+$/.test(t) || /^Ref(List)?:[A-Za-z][A-Za-z0-9_]*$/.test(t);

  function normalizedModel(raw={}) {
    const settings = normalizeSettings(raw.settings);
    const tables = (raw.tables||[]).map(r=>({
      id:text(r.id ?? r.ID), label:text(r.label ?? r.LABEL), description:text(r.description ?? r.DESCRIPTION)
    })).filter(x=>x.id);
    const columns = (raw.columns||[]).map(r=>({
      table:text(r.table ?? r.TABLE), id:text(r.id ?? r.ID), label:text(r.label ?? r.LABEL),
      type:normalizeType(r.type ?? r.TYPE, settings), display:text(r.display ?? r.DISPLAY),
      formula:text(r.formula ?? r.FORMULA), description:text(r.description ?? r.DESCRIPTION), choices:[]
    })).filter(x=>x.table&&x.id);
    const choices = (raw.choices||[]).map(r=>({
      table:text(r.table ?? r.TABLE), column:text(r.column ?? r.COLUMN), value:text(r.value ?? r.VALUE)
    })).filter(x=>x.table&&x.column&&x.value);
    const cm=new Map();
    for(const c of choices){const k=`${c.table}::${c.column}`;if(!cm.has(k))cm.set(k,[]);if(!cm.get(k).includes(c.value))cm.get(k).push(c.value);}
    for(const c of columns)c.choices=cm.get(`${c.table}::${c.id}`)||[];
    return {settings,tables,columns,choices};
  }

  function rows(wb,name){
    const ws=wb.Sheets[name];
    return ws ? XLSX.utils.sheet_to_json(ws,{defval:'',raw:false}) : null;
  }

  function parseXlsx(buf){
    if(!window.XLSX) throw new Error('Le moteur XLSX n’a pas pu être chargé.');
    const wb=XLSX.read(buf,{type:'array',cellDates:false});
    const tr=rows(wb,'TABLES'), cr=rows(wb,'COLUMNS'), chr=rows(wb,'CHOICES')||[], sr=rows(wb,'SETTINGS')||[];
    if(!tr||!cr) throw new Error('Le fichier doit contenir les feuilles TABLES et COLUMNS.');
    const settings={...DEFAULT_SETTINGS};
    for(const r of sr){const k=text(r.KEY),v=text(r.VALUE);if(k&&v&&k in settings)settings[k]=v;}
    return normalizedModel({settings,tables:tr,columns:cr,choices:chr});
  }

  function parseJson(raw){
    let obj;
    try{obj=JSON.parse(raw);}catch(e){throw new Error(`JSON invalide : ${e.message}`);}
    if(!obj || typeof obj!=='object' || Array.isArray(obj)) throw new Error('Le JSON racine doit être un objet.');
    return normalizedModel(obj);
  }

  function validate(model){
    const errors=[],warnings=[], tableIds=new Set(), lower=new Set(), colsByTable=new Map();
    for(const t of model.tables){
      if(!IDENT.test(t.id)) errors.push(`Table ${t.id} : identifiant invalide.`);
      if(lower.has(t.id.toLowerCase())) errors.push(`Table ${t.id} : identifiant dupliqué.`);
      tableIds.add(t.id); lower.add(t.id.toLowerCase());
    }
    if(!model.tables.length) errors.push('Aucune table déclarée.');
    for(const c of model.columns){
      if(!tableIds.has(c.table)) errors.push(`Colonne ${c.table}.${c.id} : table non déclarée.`);
      if(!IDENT.test(c.id)||['id','manualSort'].includes(c.id)) errors.push(`Colonne ${c.table}.${c.id} : identifiant invalide ou réservé.`);
      if(!validType(c.type)) errors.push(`Colonne ${c.table}.${c.id} : type Grist non reconnu (${c.type}).`);
      const rt=refTarget(c.type);
      if(rt&&!tableIds.has(rt)) errors.push(`Colonne ${c.table}.${c.id} : référence vers ${rt}, table absente.`);
      if(!colsByTable.has(c.table)) colsByTable.set(c.table,new Set());
      const lc=c.id.toLowerCase(); if(colsByTable.get(c.table).has(lc)) errors.push(`Colonne ${c.table}.${c.id} : identifiant dupliqué.`); colsByTable.get(c.table).add(lc);
      if(['Choice','ChoiceList'].includes(c.type)&&!c.choices.length) warnings.push(`${c.table}.${c.id} : aucune valeur CHOICES.`);
      if(c.choices.length&&!['Choice','ChoiceList'].includes(c.type)) warnings.push(`${c.table}.${c.id} : CHOICES sera ignoré pour le type ${c.type}.`);
      if(c.display){
        if(!rt) errors.push(`${c.table}.${c.id} : DISPLAY n’est autorisé que pour Ref/RefList.`);
        else {
          const targetCol=model.columns.find(x=>x.table===rt&&x.id===c.display);
          if(!targetCol) errors.push(`${c.table}.${c.id} : DISPLAY ${c.display} absent de la table ${rt}.`);
        }
      }
    }
    if(!model.settings.timezone) errors.push('SETTINGS.timezone est vide.');
    if(!model.settings.dateFormat) warnings.push('Aucun format de date défini.');
    if(!model.settings.timeFormat) warnings.push('Aucun format d’heure défini.');
    return {errors,warnings};
  }

  function setModel(model, source){
    const validation=validate(model);
    state.model=model; state.validation=validation; state.simulation=null;
    if(validation.errors.length){
      notice(`Modèle invalide : ${validation.errors.join(' | ')}`,'error');
      show(els.previewSection,false); show(els.simulationSection,false); return false;
    }
    notice(validation.warnings.length?`Modèle valide avec ${validation.warnings.length} avertissement(s).`:'Modèle valide.','success');
    renderPreview(source, validation);
    return true;
  }

  function renderPreview(source, validation){
    const m=state.model;
    els.sourceLabel.textContent=`Source : ${source}. Vérifiez la structure avant la simulation.`;
    els.settingsPreview.innerHTML=[
      `Fuseau : ${m.settings.timezone}`,`Date : ${m.settings.dateFormat}`,`Heure : ${m.settings.timeFormat}`
    ].map(x=>`<span>${esc(x)}</span>`).join('');
    const refs=m.columns.filter(c=>refTarget(c.type)).length, forms=m.columns.filter(c=>c.formula).length,
      displays=m.columns.filter(c=>c.display).length;
    els.metrics.innerHTML=[['Tables',m.tables.length],['Colonnes',m.columns.length],['Références',refs],['Affichages Ref',displays],['Formules',forms]]
      .map(([l,v])=>`<div class="metric"><strong>${v}</strong><span>${l}</span></div>`).join('');
    els.tablesPreview.innerHTML=m.tables.map(t=>{
      const cs=m.columns.filter(c=>c.table===t.id);
      return `<div class="table-block"><div class="table-title"><strong>${esc(t.label||t.id)}</strong><span>${esc(t.id)} · ${cs.length} colonnes</span></div>
      <div class="table-scroll"><table><thead><tr><th>ID</th><th>Libellé</th><th>Type</th><th>Affichage Ref</th><th>Choix</th><th>Formule</th></tr></thead><tbody>
      ${cs.map(c=>`<tr><td><code>${esc(c.id)}</code></td><td>${esc(c.label||'—')}</td><td><code>${esc(c.type)}</code></td><td>${esc(c.display||'—')}</td><td>${c.choices.length?esc(c.choices.join(', ')):'—'}</td><td>${c.formula?`<code>${esc(c.formula)}</code>`:'—'}</td></tr>`).join('')}
      </tbody></table></div></div>`;
    }).join('');
    els.modelState.className=validation.warnings.length?'status status-wait':'status status-ok';
    els.modelState.innerHTML=`<span class="dot"></span><span>${validation.warnings.length?'Valide avec avertissements':'Modèle valide'}</span>`;
    show(els.previewSection,true); show(els.simulationSection,false); show(els.progressSection,false);
    els.previewSection.scrollIntoView({behavior:'smooth',block:'start'});
  }

  function tableDataToRows(data){
    if(Array.isArray(data)) return data;
    if(!data||typeof data!=='object') return [];
    const keys=Object.keys(data).filter(k=>Array.isArray(data[k]));
    if(!keys.length) return [];
    const length=Math.max(...keys.map(k=>data[k].length));
    return Array.from({length},(_,i)=>Object.fromEntries(keys.map(k=>[k,data[k][i]])));
  }

  async function fetchSchema(){
    const tableIds=await grist.docApi.listTables();
    const mt=tableDataToRows(await grist.docApi.fetchTable('_grist_Tables'));
    const mc=tableDataToRows(await grist.docApi.fetchTable('_grist_Tables_column'));
    const tableIdByRef=new Map(mt.map(r=>[r.id,r.tableId]));
    const rowsByKey=new Map(), columnsByTable=new Map();
    for(const tid of tableIds) columnsByTable.set(tid,new Map());
    for(const c of mc){
      const tid=tableIdByRef.get(c.parentId);
      if(tid){rowsByKey.set(`${tid}::${c.colId}`,c); if(columnsByTable.has(tid)) columnsByTable.get(tid).set(c.colId,c);}
    }
    return {tableIds:new Set(tableIds),tableIdByRef,columnsByTable,rowsByKey,metaCols:mc};
  }

  function safeWidgetOptions(raw){
    if(!raw) return {};
    if(typeof raw==='object') return raw;
    try{return JSON.parse(raw);}catch{return {};}
  }

  function expectedWidgetOptions(c, settings){
    const opts={};
    if(c.choices?.length) opts.choices=c.choices;
    if(c.type==='Date'){
      opts.dateFormat=settings.dateFormat; opts.isCustomDateFormat=true;
    }
    if(c.type.startsWith('DateTime:')){
      opts.dateFormat=settings.dateFormat; opts.timeFormat=settings.timeFormat;
      opts.isCustomDateFormat=true; opts.isCustomTimeFormat=true;
    }
    return opts;
  }

  function displayMatches(c, ex, schema){
    if(!c.display) return !ex?.visibleCol;
    const target=refTarget(c.type); const targetRow=schema.rowsByKey.get(`${target}::${c.display}`);
    return Boolean(targetRow && ex?.visibleCol===targetRow.id);
  }

  async function simulate(){
    if(!state.model)return;
    els.simulateBtn.disabled=true; els.simulateBtn.textContent='Simulation…';
    try{
      const schema=await fetchSchema();
      let newTables=0,newColumns=0,mismatches=0;
      const details=[];
      for(const t of state.model.tables){
        const exists=schema.tableIds.has(t.id); if(!exists)newTables++;
        const colDetails=[];
        for(const c of state.model.columns.filter(x=>x.table===t.id)){
          const ex=schema.columnsByTable.get(t.id)?.get(c.id);
          if(!ex){newColumns++;colDetails.push({c,status:'add',message:'À créer'});continue;}
          const fm=Boolean(c.formula)!==Boolean(ex.isFormula)||(c.formula&&c.formula!==ex.formula);
          const displayMismatch=!displayMatches(c,ex,schema);
          const expectedOpts=expectedWidgetOptions(c,state.model.settings), actualOpts=safeWidgetOptions(ex.widgetOptions);
          const formatMismatch=(c.type==='Date'||c.type.startsWith('DateTime:')) &&
            (actualOpts.dateFormat!==expectedOpts.dateFormat || (c.type.startsWith('DateTime:')&&actualOpts.timeFormat!==expectedOpts.timeFormat));
          if(ex.type!==c.type||fm||displayMismatch||formatMismatch){
            mismatches++;
            const reasons=[];
            if(ex.type!==c.type)reasons.push(`type ${ex.type}`);
            if(fm)reasons.push('formule différente');
            if(displayMismatch)reasons.push('affichage Ref différent');
            if(formatMismatch)reasons.push('format date/heure différent');
            colDetails.push({c,status:'warn',message:`Existe : ${reasons.join(' · ')}`});
          } else colDetails.push({c,status:'same',message:'Déjà conforme'});
        }
        details.push({t,exists,colDetails});
      }
      state.simulation={schema,newTables,newColumns,mismatches,details};
      renderSimulation();
    }catch(e){notice(`Simulation impossible : ${e.message}`,'error');}
    finally{els.simulateBtn.disabled=false;els.simulateBtn.textContent='Simuler dans ce document';}
  }

  function renderSimulation(){
    const s=state.simulation;
    els.simulationSummary.innerHTML=`<div class="sim-box"><strong>${s.newTables}</strong> tables à créer</div><div class="sim-box"><strong>${s.newColumns}</strong> colonnes à créer</div><div class="sim-box"><strong>${s.mismatches}</strong> différences existantes</div>`;
    els.simulationDetails.innerHTML=s.details.map(d=>`<div class="table-block"><div class="table-title"><strong>${esc(d.t.label||d.t.id)}</strong><span class="pill ${d.exists?'same':'add'}">${d.exists?'Table existante':'Table à créer'}</span></div>
    <div class="table-scroll"><table><thead><tr><th>Colonne</th><th>Type attendu</th><th>Action</th></tr></thead><tbody>
    ${d.colDetails.map(x=>`<tr><td><code>${esc(x.c.id)}</code></td><td><code>${esc(x.c.type)}</code></td><td><span class="pill ${x.status}">${esc(x.message)}</span></td></tr>`).join('')}
    </tbody></table></div></div>`).join('');
    if(s.mismatches){
      els.warningBox.textContent='Les colonnes existantes différentes ne seront pas modifiées automatiquement. Le widget ne crée que les tables/colonnes manquantes et configure les nouvelles références.';
      show(els.warningBox,true);
    }else show(els.warningBox,false);
    els.buildBtn.disabled=(s.newTables===0&&s.newColumns===0);
    els.buildBtn.title=els.buildBtn.disabled?'Aucun élément manquant à construire.':'';
    show(els.simulationSection,true);
    els.simulationSection.scrollIntoView({behavior:'smooth',block:'start'});
  }

  function orderedTables(model){
    const deps=new Map(model.tables.map(t=>[t.id,new Set()]));
    for(const c of model.columns){const rt=refTarget(c.type);if(rt&&rt!==c.table)deps.get(c.table)?.add(rt);}
    const out=[],vis=new Set(),done=new Set();
    function visit(id){if(done.has(id)||vis.has(id))return;vis.add(id);for(const d of deps.get(id)||[])visit(d);vis.delete(id);done.add(id);out.push(id);}
    for(const t of model.tables)visit(t.id);return out;
  }

  function columnAction(c){
    const opts=expectedWidgetOptions(c,state.model.settings);
    return {id:c.id,type:c.type,isFormula:Boolean(c.formula),formula:c.formula||'',widgetOptions:JSON.stringify(opts)};
  }

  async function updateMetadata(tableId, modelCols){
    const schema=await fetchSchema();
    const rows=modelCols.map(c=>({c,r:schema.rowsByKey.get(`${tableId}::${c.id}`)})).filter(x=>x.r);
    if(!rows.length)return;
    const ids=[],labels=[],descs=[],untied=[],opts=[];
    for(const {c,r} of rows){
      ids.push(r.id);labels.push(c.label||c.id);descs.push(c.description||'');untied.push(true);
      opts.push(JSON.stringify({...safeWidgetOptions(r.widgetOptions),...expectedWidgetOptions(c,state.model.settings)}));
    }
    await grist.docApi.applyUserActions([['BulkUpdateRecord','_grist_Tables_column',ids,{label:labels,description:descs,untieColIdFromLabel:untied,widgetOptions:opts}]]);
  }

  async function applyDisplays(createdKeys){
    const schema=await fetchSchema();
    const sourceIds=[],visibleIds=[];
    for(const c of state.model.columns){
      const key=`${c.table}::${c.id}`;
      if(!createdKeys.has(key)||!c.display)continue;
      const src=schema.rowsByKey.get(key), targetTable=refTarget(c.type), target=schema.rowsByKey.get(`${targetTable}::${c.display}`);
      if(src&&target){sourceIds.push(src.id);visibleIds.push(target.id);}
    }
    if(sourceIds.length) await grist.docApi.applyUserActions([['BulkUpdateRecord','_grist_Tables_column',sourceIds,{visibleCol:visibleIds}]]);
  }

  async function build(){
    if(!state.simulation)return;
    if(!confirm('Construire les tables et colonnes manquantes dans ce document ? Les colonnes existantes ne seront pas modifiées.'))return;
    show(els.progressSection,true);els.buildLog.innerHTML='';els.buildBtn.disabled=true;els.progressBar.style.width='0';
    const order=orderedTables(state.model), total=order.length;let done=0;const createdKeys=new Set();
    const log=(m,k='')=>{const d=document.createElement('div');d.className=k?`log-${k}`:'';d.textContent=m;els.buildLog.appendChild(d);els.buildLog.scrollTop=els.buildLog.scrollHeight;};
    try{
      let schema=await fetchSchema();
      for(const tableId of order){
        const t=state.model.tables.find(x=>x.id===tableId), cs=state.model.columns.filter(c=>c.table===tableId);
        els.progressText.textContent=`Traitement de ${t.label||tableId}…`;
        const created=[];
        if(!schema.tableIds.has(tableId)){
          await grist.docApi.applyUserActions([['AddTable',tableId,cs.map(columnAction)]]);
          for(const c of cs){created.push(c);createdKeys.add(`${tableId}::${c.id}`);}
          log(`✓ Table ${tableId} créée avec ${cs.length} colonnes.`,'ok');
        }else{
          const existing=schema.columnsByTable.get(tableId)||new Map();
          for(const c of cs)if(!existing.has(c.id)){
            const info=columnAction(c);
            await grist.docApi.applyUserActions([['AddColumn',tableId,c.id,{type:info.type,isFormula:info.isFormula,formula:info.formula,widgetOptions:info.widgetOptions}]]);
            created.push(c);createdKeys.add(`${tableId}::${c.id}`);log(`✓ Colonne ${tableId}.${c.id} créée.`,'ok');
          }
        }
        if(created.length)await updateMetadata(tableId,created);
        done++;els.progressBar.style.width=`${Math.round(done/total*90)}%`;schema=await fetchSchema();
      }
      await applyDisplays(createdKeys);els.progressBar.style.width='100%';
      els.progressText.textContent='Construction terminée.';log('✓ Construction terminée.','ok');notice('Le modèle a été appliqué au document.','success');
      await simulate();
    }catch(e){els.progressText.textContent='Erreur pendant la construction.';log(`Erreur : ${e.message}`,'error');notice(`Construction interrompue : ${e.message}`,'error');}
    finally{if(state.simulation)els.buildBtn.disabled=(state.simulation.newTables===0&&state.simulation.newColumns===0);}
  }

  function downloadBlob(blob,name){
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }

  function modelToJson(model){
    return {
      settings:model.settings,
      tables:model.tables.map(({id,label,description})=>({id,label,description})),
      columns:model.columns.map(({table,id,label,type,display,formula,description})=>({table,id,label,type,display,formula,description})),
      choices:model.choices.map(({table,column,value})=>({table,column,value}))
    };
  }

  function modelToWorkbook(model){
    const wb=XLSX.utils.book_new();
    const intro=[['GRIST MODEL BUILDER — EXPORT DE SCHÉMA'],['Ce fichier peut être réimporté après modification.']];
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(intro),'LIRE_MOI');
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet([
      {KEY:'timezone',VALUE:model.settings.timezone,DESCRIPTION:'Fuseau DateTime par défaut'},
      {KEY:'dateFormat',VALUE:model.settings.dateFormat,DESCRIPTION:'Format des dates'},
      {KEY:'timeFormat',VALUE:model.settings.timeFormat,DESCRIPTION:'Format des heures'}
    ],{header:['KEY','VALUE','DESCRIPTION']}),'SETTINGS');
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(model.tables.map(t=>({ID:t.id,LABEL:t.label,DESCRIPTION:t.description})),{header:['ID','LABEL','DESCRIPTION']}),'TABLES');
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(model.columns.map(c=>({TABLE:c.table,ID:c.id,LABEL:c.label,TYPE:c.type,DISPLAY:c.display,FORMULA:c.formula,DESCRIPTION:c.description})),{header:['TABLE','ID','LABEL','TYPE','DISPLAY','FORMULA','DESCRIPTION']}),'COLUMNS');
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(model.choices.map(c=>({TABLE:c.table,COLUMN:c.column,VALUE:c.value})),{header:['TABLE','COLUMN','VALUE']}),'CHOICES');
    return wb;
  }

  async function exportCurrentModel(){
    const schema=await fetchSchema();
    const tableIds=[...schema.tableIds];
    const tables=tableIds.map(id=>({id,label:id,description:''}));
    const columns=[],choices=[];
    for(const tableId of tableIds){
      for(const [colId,r] of schema.columnsByTable.get(tableId)||[]){
        if(['id','manualSort'].includes(colId))continue;
        const opts=safeWidgetOptions(r.widgetOptions);
        let display='';
        const rt=refTarget(r.type);
        if(rt&&r.visibleCol){
          const visible=schema.metaCols.find(x=>x.id===r.visibleCol);
          if(visible)display=visible.colId||'';
        }
        columns.push({table:tableId,id:colId,label:text(r.label)||colId,type:r.type||'Any',display,formula:r.formula||'',description:r.description||'',choices:[]});
        if(['Choice','ChoiceList'].includes(r.type)&&Array.isArray(opts.choices)){
          for(const value of opts.choices)choices.push({table:tableId,column:colId,value:String(value)});
        }
      }
    }
    return normalizedModel({settings:DEFAULT_SETTINGS,tables,columns,choices});
  }

  async function exportSchema(format){
    const btn=format==='json'?els.exportJsonBtn:els.exportXlsxBtn;
    const original=btn.textContent;btn.disabled=true;btn.textContent='Export…';
    try{
      const model=await exportCurrentModel();
      if(format==='json'){
        downloadBlob(new Blob([JSON.stringify(modelToJson(model),null,2)],{type:'application/json'}),'schema-grist.json');
      }else{
        const out=XLSX.write(modelToWorkbook(model),{bookType:'xlsx',type:'array'});
        downloadBlob(new Blob([out],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),'schema-grist.xlsx');
      }
      notice(`Schéma Grist exporté en ${format.toUpperCase()}.`,'success');
    }catch(e){notice(`Export impossible : ${e.message}`,'error');}
    finally{btn.disabled=false;btn.textContent=original;}
  }

  function choosePath(mode){
    state.mode=mode;show(els.xlsxPath,mode==='xlsx');show(els.jsonPath,mode==='json');
    show(els.previewSection,false);show(els.simulationSection,false);show(els.progressSection,false);show(els.analysisMessage,false);
    (mode==='xlsx'?els.xlsxPath:els.jsonPath).scrollIntoView({behavior:'smooth',block:'start'});
  }

  async function analyzeXlsx(){
    if(!state.file)return;
    els.analyzeXlsxBtn.disabled=true;els.analyzeXlsxBtn.textContent='Analyse…';
    try{setModel(parseXlsx(await state.file.arrayBuffer()),'XLSX');}
    catch(e){notice(`Impossible d’analyser le XLSX : ${e.message}`,'error');}
    finally{els.analyzeXlsxBtn.disabled=false;els.analyzeXlsxBtn.textContent='Analyser le XLSX';}
  }
  function analyzeJson(){try{setModel(parseJson(els.jsonText.value),'JSON');}catch(e){notice(e.message,'error');}}
  function resetAll(){
    state.file=null;state.model=null;state.validation=null;state.simulation=null;
    els.xlsxInput.value='';els.xlsxFileName.textContent='Aucun fichier chargé';els.analyzeXlsxBtn.disabled=true;
    show(els.previewSection,false);show(els.simulationSection,false);show(els.progressSection,false);show(els.analysisMessage,false);
    window.scrollTo({top:0,behavior:'smooth'});
  }

  async function loadPrompt(path,target){
    try{target.textContent=await(await fetch(`${path}?v=1.1.0`)).text();}catch{target.textContent='Prompt indisponible.';}
  }
  async function copyPrompt(path,button){
    try{
      const txt=await(await fetch(`${path}?v=1.1.0`)).text();
      await navigator.clipboard.writeText(txt);
      const old=button.textContent;button.textContent='Prompt copié ✓';setTimeout(()=>button.textContent=old,1600);
    }catch(e){notice(`Copie impossible : ${e.message}`,'error');}
  }

  els.chooseXlsx.addEventListener('click',()=>choosePath('xlsx'));
  els.chooseJson.addEventListener('click',()=>choosePath('json'));
  document.querySelectorAll('.changePath').forEach(b=>b.addEventListener('click',()=>{show(els.xlsxPath,false);show(els.jsonPath,false);window.scrollTo({top:0,behavior:'smooth'});}));
  document.querySelectorAll('.copy-prompt').forEach(b=>b.addEventListener('click',()=>copyPrompt(b.dataset.prompt,b)));
  els.xlsxInput.addEventListener('change',e=>{state.file=e.target.files[0]||null;els.xlsxFileName.textContent=state.file?`${state.file.name} · ${Math.round(state.file.size/1024)} Ko`:'Aucun fichier chargé';els.analyzeXlsxBtn.disabled=!state.file;});
  ['dragenter','dragover'].forEach(ev=>els.xlsxDrop.addEventListener(ev,e=>{e.preventDefault();els.xlsxDrop.classList.add('drag');}));
  ['dragleave','drop'].forEach(ev=>els.xlsxDrop.addEventListener(ev,e=>{e.preventDefault();els.xlsxDrop.classList.remove('drag');}));
  els.xlsxDrop.addEventListener('drop',e=>{const f=e.dataTransfer.files[0];if(f){state.file=f;els.xlsxFileName.textContent=`${f.name} · ${Math.round(f.size/1024)} Ko`;els.analyzeXlsxBtn.disabled=false;}});
  els.analyzeXlsxBtn.addEventListener('click',analyzeXlsx);
  els.jsonInput.addEventListener('change',async e=>{const f=e.target.files[0];if(!f)return;els.jsonFileName.textContent=f.name;els.jsonText.value=await f.text();});
  els.formatJsonBtn.addEventListener('click',()=>{try{els.jsonText.value=JSON.stringify(JSON.parse(els.jsonText.value),null,2);}catch(e){notice(`JSON invalide : ${e.message}`,'error');}});
  els.analyzeJsonBtn.addEventListener('click',analyzeJson);
  els.simulateBtn.addEventListener('click',simulate);els.resimulateBtn.addEventListener('click',simulate);els.buildBtn.addEventListener('click',build);els.resetBtn.addEventListener('click',resetAll);
  els.exportJsonBtn.addEventListener('click',()=>exportSchema('json'));els.exportXlsxBtn.addEventListener('click',()=>exportSchema('xlsx'));

  function setAccess(level){
    state.access=level||'none';
    if(level==='full'){els.accessBadge.className='status status-ok';els.accessBadge.innerHTML='<span class="dot"></span><span>Accès complet au document</span>';}
    else{els.accessBadge.className='status status-wait';els.accessBadge.innerHTML='<span class="dot"></span><span>Accès complet demandé</span>';}
  }

  loadPrompt('prompt-xlsx.txt',els.xlsxPrompt);loadPrompt('prompt-json.txt',els.jsonPrompt);
  grist.onOptions((_options,interaction)=>setAccess(interaction?.accessLevel||interaction?.access_level||'none'));
  grist.ready({requiredAccess:'full'});
})();