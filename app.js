/* Лабораторная работа №3 — Student Performance (UCI), курс математики.
   Никакой сервер, API-ключ или сборщик не требуются: все расчёты делаются в браузере. */
'use strict';

const SOURCE = Object.freeze({
  uci: 'https://archive.ics.uci.edu/dataset/320/student+performance',
  mirror: 'https://raw.githubusercontent.com/MakroMB/student-performance-analysis/main/data/student-mat.csv',
  localFull: './student-mat.csv',
  localFallback: './sample_students.csv',
  expectedCount: 395,
});
const COLORS = ['#ff8b88', '#f6c56d', '#57d3a8'];
const FILLS = ['rgba(255,139,136,0.34)', 'rgba(246,197,109,0.34)', 'rgba(87,211,168,0.32)'];
const BANDS = ['0–9', '10–13', '14–20'];
const STUDY = ['', 'меньше 2 часов', '2–5 часов', '5–10 часов', 'больше 10 часов'];
const STUDY_SHORT = ['', '<2 ч', '2–5 ч', '5–10 ч', '>10 ч'];
const FONT = 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif';
const plotConfig = {responsive: true, displaylogo: false, toImageButtonOptions: {format:'png', scale:2, filename:'lab3_student_performance'}, modeBarButtonsToRemove: ['lasso2d','select2d']};
let students = [];
let sourceMode = 'loading';
let fullCsv = '';
let redrawScheduled = false;

const $ = id => document.getElementById(id);
const band = grade => grade < 10 ? 0 : grade < 14 ? 1 : 2;
const formatNumber = n => new Intl.NumberFormat('ru-RU').format(n);
const formatDecimal = n => new Intl.NumberFormat('ru-RU',{minimumFractionDigits:1,maximumFractionDigits:1}).format(n);
const percent = (part, total) => total ? formatDecimal(100 * part / total) + '%' : '—';
const mean = (arr, key) => arr.length ? arr.reduce((sum, item) => sum + key(item),0) / arr.length : 0;
function median(numbers) {
  if (!numbers.length) return null;
  const sorted = [...numbers].sort((a,b) => a-b);
  const middle = Math.floor(sorted.length/2);
  return sorted.length%2 ? sorted[middle] : (sorted[middle-1]+sorted[middle])/2;
}
function parseDelimited(text) {
  const normalized = String(text).replace(/^\uFEFF/,'').trim();
  const lines = normalized.split(/\r?\n/).filter(Boolean);
  if (!lines.length) throw new Error('Пустой CSV');
  const delimiter = lines[0].includes(';') ? ';' : ',';
  const fields = lines[0].split(delimiter).map(s => s.trim().replace(/^"|"$/g,''));
  const required = ['school','sex','studytime','absences','G1','G2','G3'];
  if (!required.every(field => fields.includes(field))) throw new Error('CSV не содержит обязательные поля');
  const results = [];
  for (let lineNumber=1; lineNumber<lines.length; lineNumber++) {
    const parts = lines[lineNumber].split(delimiter).map(x=>x.trim().replace(/^"|"$/g,''));
    if (parts.length !== fields.length) throw new Error('Некорректное число столбцов в строке '+(lineNumber+1));
    const entry = Object.fromEntries(fields.map((key,i)=>[key,parts[i]]));
    const row = {
      row: Number(entry.row ?? lineNumber), school:entry.school, sex:entry.sex,
      studytime:Number(entry.studytime), absences:Number(entry.absences),
      G1:Number(entry.G1), G2:Number(entry.G2), G3:Number(entry.G3)
    };
    if (!['GP','MS'].includes(row.school) || !['M','F'].includes(row.sex) ||
        ![1,2,3,4].includes(row.studytime) || !Number.isInteger(row.absences) || row.absences<0 ||
        ![row.G1,row.G2,row.G3].every(g => Number.isInteger(g)&&g>=0&&g<=20)) {
      throw new Error('Некорректные значения в строке '+(lineNumber+1));
    }
    results.push(row);
  }
  if (!results.length) throw new Error('CSV не содержит записей');
  return results;
}
async function getText(url, timeout=8500) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const response = await fetch(url,{signal:ctrl.signal,cache:'no-store'});
    if (!response.ok) throw new Error('HTTP '+response.status+' для '+url);
    return await response.text();
  } finally { clearTimeout(timer); }
}
function setStatus(mode, n) {
  sourceMode = mode;
  const widget = $('data-status');
  widget.className = 'data-state '+(mode==='full'?'complete':'demo');
  if (mode==='full') {
    $('data-status-text').textContent = '';
    $('source-technical').textContent = 'Загружен полный файл student-mat.csv ('+formatNumber(n)+' записей). Все расчёты выполнены в браузере без искусственно созданных значений.';
  } else {
    $('data-status-text').textContent = '';
    $('source-technical').textContent = 'Полный исходный CSV временно недоступен, поэтому используется встроенный проверенный фрагмент. Для автономной публикации можно положить student-mat.csv рядом с сайтом в репозиторий.';
  }
}
function useData(rows, mode, csvString) {
  const oldMax = Number($('absences-filter').max);
  const atMaximum = Number($('absences-filter').value) >= oldMax;
  students = rows;
  fullCsv = csvString;
  const newMax = Math.max(0,...rows.map(r => r.absences));
  $('absences-filter').max = newMax;
  $('absences-max').textContent = String(newMax);
  if (atMaximum) $('absences-filter').value = newMax;
  else if (Number($('absences-filter').value) > newMax) $('absences-filter').value = newMax;
  $('absences-value').textContent = $('absences-filter').value;
  setStatus(mode,rows.length);
  scheduleRender();
}
function filteredStudents() {
  const school = $('school-filter').value, sex = $('sex-filter').value;
  const study = $('study-filter').value, targetBand = $('band-filter').value;
  const maxAbs = Number($('absences-filter').value);
  return students.filter(s =>
    (school==='all'||s.school===school) &&
    (sex==='all'||s.sex===sex) &&
    (study==='all'||s.studytime===Number(study)) &&
    (targetBand==='all'||band(s.G3)===Number(targetBand)) && s.absences<=maxAbs
  );
}
function renderMetrics(rows) {
  $('kpi-count').textContent = formatNumber(rows.length);
  $('kpi-average').textContent = rows.length ? formatDecimal(mean(rows,r=>r.G3)) : '—';
  $('kpi-passed').textContent = percent(rows.filter(r=>r.G3>=10).length, rows.length);
  if (rows.length) { const delta=mean(rows,r=>r.G3-r.G1); $('kpi-delta').textContent = (delta>0?'+':'')+formatDecimal(delta); }
  else $('kpi-delta').textContent = '—';
  $('subset-count').textContent = 'Выбрано '+formatNumber(rows.length)+' из '+formatNumber(students.length);
}
const layoutBase = () => ({paper_bgcolor:'rgba(0,0,0,0)',plot_bgcolor:'rgba(0,0,0,0)',font:{family:FONT,color:'#b7c9df',size:11},hoverlabel:{bgcolor:'#102038',bordercolor:'#243855',font:{color:'#eff6ff',family:FONT,size:12}}});
function emptyGraphs() {
  for (const name of ['sankey','sunburst','beeswarm']) {
    const root = $('chart-'+name);
    if (root.classList.contains('js-plotly-plot')) Plotly.purge(root);
    root.innerHTML = '<div class="empty-chart">По заданным условиям нет наблюдений.<br>Ослабьте фильтры или нажмите «Сбросить».</div>';
  }
  for (const name of ['sankey','sunburst','beeswarm']) $('insight-'+name).textContent='Нет данных для текущего набора фильтров.';
}
async function plotSankey(rows) {
  const n=rows.length;
  const transitions = new Map();
  const add=(from,to)=>{let key=from+'-'+to;transitions.set(key,(transitions.get(key)||0)+1);};
  rows.forEach(r=>{add(band(r.G1),3+band(r.G2));add(3+band(r.G2),6+band(r.G3));});
  const entries=[...transitions].map(([key,count])=>{const [source,target]=key.split('-').map(Number);return {source,target,count};});
  const labels=[...Array(9)].map((_,i)=>'G'+(Math.floor(i/3)+1)+' · '+BANDS[i%3]);
  const trace={type:'sankey',orientation:'h',arrangement:'snap',valueformat:'d',
    node:{label:labels,pad:21,thickness:20,x:[.015,.015,.015,.5,.5,.5,.985,.985,.985],color:[...COLORS,...COLORS,...COLORS],
      line:{color:'rgba(255,255,255,0.08)',width:1},hovertemplate:'%{label}<br>%{value} учеников<extra></extra>'},
    link:{source:entries.map(e=>e.source),target:entries.map(e=>e.target),value:entries.map(e=>e.count),
      color:entries.map(e=>FILLS[e.source%3]),hovertemplate:'%{source.label} → %{target.label}<br><b>%{value} учеников</b><extra></extra>'}
  };
  const layout={...layoutBase(),margin:{l:16,r:16,t:47,b:10},
    annotations:[{x:.02,text:'I ПЕРИОД · G1'},{x:.50,text:'II ПЕРИОД · G2'},{x:.98,text:'ИТОГ · G3'}].map(a=>({x:a.x,y:1.11,text:a.text,xref:'paper',yref:'paper',xanchor:'center',showarrow:false,font:{size:10,color:'#8da5c5',family:FONT}}))};
  await Plotly.react('chart-sankey',[trace],layout,plotConfig);
  const up = rows.filter(r=>band(r.G3)>band(r.G1)).length;
  const down = rows.filter(r=>band(r.G3)<band(r.G1)).length;
  const same=n-up-down;
  $('insight-sankey').textContent = 'По сравнению с G1 итоговая группа стала выше у '+percent(up,n)+' учеников, ниже — у '+percent(down,n)+'. В той же группе осталось '+formatNumber(same)+' из '+formatNumber(n)+'.';
}
async function plotSunburst(rows) {
  const nodes=[{id:'root',label:'Все ученики',parent:'',value:rows.length,color:'#e9eef4'}];
  for (const school of ['GP','MS']) {
    const schoolRows=rows.filter(r=>r.school===school);
    if (!schoolRows.length) continue;
    nodes.push({id:'school:'+school,parent:'root',label:school,value:schoolRows.length,color:'#91a4d6'});
    for (let st=1;st<=4;st++) {
      const sub=schoolRows.filter(r=>r.studytime===st);
      if (!sub.length) continue;
      const id='school:'+school+'/study:'+st;
      nodes.push({id,parent:'school:'+school,label:STUDY_SHORT[st],value:sub.length,color:'#c8d7ef'});
      for (let b=0;b<3;b++) {
        const count=sub.filter(r=>band(r.G3)===b).length;
        if (count) nodes.push({id:id+'/band:'+b,parent:id,label:BANDS[b],value:count,color:COLORS[b]});
      }
    }
  }
  const trace={type:'sunburst',ids:nodes.map(n=>n.id),labels:nodes.map(n=>n.label),parents:nodes.map(n=>n.parent),values:nodes.map(n=>n.value),branchvalues:'total',
    marker:{colors:nodes.map(n=>n.color),line:{color:'rgba(255,255,255,0.08)',width:2}},maxdepth:4,
    insidetextorientation:'radial',textinfo:'label',hovertemplate:'%{label}<br><b>%{value} учеников</b><br>%{percentParent:.1%} от родительской группы<extra></extra>',
    sort:false};
  await Plotly.react('chart-sunburst',[trace],{...layoutBase(),margin:{l:10,r:10,t:5,b:5},uniformtext:{minsize:10,mode:'hide'}},plotConfig);
  const counts=[1,2,3,4].map(st=>({st,count:rows.filter(r=>r.studytime===st).length})).filter(p=>p.count);
  counts.sort((a,b)=>b.count-a.count || a.st-b.st);
  const biggest=counts[0];
  $('insight-sunburst').textContent = 'Наиболее многочисленная категория по времени учёбы — «'+STUDY[biggest.st]+'» ('+formatNumber(biggest.count)+' из '+formatNumber(rows.length)+', '+percent(biggest.count,rows.length)+'). Размер сектора означает число учеников, а не средний балл.';
}
async function plotBeeswarm(rows) {
  // Раздвижение строго по X при одинаковом целом G3; координата Y всегда равна фактическому баллу.
  // При большом числе совпадений шаг уменьшается, чтобы точки не заходили на соседние категории.
  const traces=[0,1,2].map((b)=>({type:'scatter',mode:'markers',name:BANDS[b],x:[],y:[],customdata:[],showlegend:false,
    marker:{color:COLORS[b],size:7.5,opacity:.82,line:{color:'rgba(255,255,255,0.18)',width:.6}},
    hovertemplate:'Итог G3: <b>%{y} / 20</b><br>Занятия: %{customdata[0]}<br>Школа: %{customdata[1]}<br>G1 → G2: %{customdata[2]} → %{customdata[3]}<br>Пропуски: %{customdata[4]}<extra></extra>'}));
  for (let st=1;st<=4;st++) {
    for (let score=0;score<=20;score++) {
      const items=rows.filter(r=>r.studytime===st&&r.G3===score).sort((a,b)=>a.row-b.row);
      if (!items.length) continue;
      const step=items.length>1?Math.min(.046,.76/(items.length-1)):0;
      const index=band(score);
      items.forEach((r,i)=>{
        traces[index].x.push(st+(i-(items.length-1)/2)*step);
        traces[index].y.push(score);
        traces[index].customdata.push([STUDY[st],r.school,r.G1,r.G2,r.absences]);
      });
    }
  }
  const shapes=[],annotations=[];
  const stats=[];
  for (let st=1;st<=4;st++) {
    const values=rows.filter(r=>r.studytime===st).map(r=>r.G3), med=median(values);
    if (med===null) continue;
    stats.push({st,med,n:values.length});
    shapes.push({type:'line',x0:st-.27,x1:st+.27,y0:med,y1:med,xref:'x',yref:'y',line:{color:'#9dc2ff',width:2.4}});
    annotations.push({x:st,y:21.3,text:'Медиана '+formatDecimal(med),xref:'x',yref:'y',showarrow:false,font:{size:10,color:'#9cb2cc',family:FONT}});
  }
  const layout={...layoutBase(),margin:{l:48,r:13,t:27,b:43},
    xaxis:{range:[.48,4.52],tickvals:[1,2,3,4],ticktext:STUDY_SHORT.slice(1),tickfont:{size:11,color:'#dbe7f6'},zeroline:false,showline:true,linecolor:'rgba(171,197,230,0.22)',showgrid:false,fixedrange:true},
    yaxis:{range:[-.6,22],tickvals:[0,5,10,15,20],title:{text:'Итоговая оценка G3 · баллы',font:{size:10,color:'#a9bdd6'},standoff:6},gridcolor:'rgba(171,197,230,0.12)',zeroline:false,fixedrange:true},
    shapes,annotations,showlegend:false,hovermode:'closest',dragmode:false};
  await Plotly.react('chart-beeswarm',traces,layout,plotConfig);
  stats.sort((a,b)=>b.med-a.med || b.n-a.n);
  if (stats.length===1) $('insight-beeswarm').textContent='В выбранной группе «'+STUDY[stats[0].st]+'» медиана G3 равна '+formatDecimal(stats[0].med)+' балла (n='+stats[0].n+'). Каждый кружок соответствует отдельному ученику.';
  else $('insight-beeswarm').textContent = 'Наибольшая медиана G3 среди представленных категорий — '+formatDecimal(stats[0].med)+' балла в группе «'+STUDY[stats[0].st]+'» (n='+stats[0].n+'). Различия не свидетельствуют о причинном влиянии длительности занятий.';
}
function scheduleRender() {
  if (redrawScheduled) return;
  redrawScheduled=true;
  requestAnimationFrame(async()=>{
    redrawScheduled=false;
    if (!students.length || typeof Plotly==='undefined') return;
    const rows=filteredStudents();
    renderMetrics(rows);
    if (!rows.length) {emptyGraphs();return;}
    try {await Promise.all([plotSankey(rows),plotSunburst(rows),plotBeeswarm(rows)]);}
    catch(err) {console.error('Ошибка построения графиков',err);$('data-status-text').textContent='Ошибка построения: откройте консоль браузера';}
  });
}
function downloadCSV() {
  const rows=filteredStudents();
  const cols=['row','school','sex','studytime','absences','G1','G2','G3'];
  const csv='\uFEFF'+[cols.join(';'),...rows.map(row=>cols.map(key=>row[key]).join(';'))].join('\r\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));
  const link=document.createElement('a');link.href=url;link.download='lab3_students_filtered.csv';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),500);
}
function resetFilters() {
  for (const id of ['school-filter','sex-filter','study-filter','band-filter']) $(id).value='all';
  $('absences-filter').value=$('absences-filter').max;
  $('absences-value').textContent=$('absences-filter').value;
  scheduleRender();
}
async function loadData() {
  // Локальный резерв нужен, чтобы опубликованная страница оставалась функциональной
  // даже в сетях, блокирующих raw.githubusercontent.com.
  try {const sample=await getText(SOURCE.localFallback,5000);useData(parseDelimited(sample),'demo',sample);}
  catch(err){console.error('Не удалось прочитать резервный CSV',err);$('data-status-text').textContent='Ошибка: резервный файл данных недоступен';}
  for (const url of [SOURCE.localFull,SOURCE.mirror]) {
    try {
      const csv=await getText(url,url===SOURCE.localFull?4000:10000);
      const parsed=parseDelimited(csv);
      if (parsed.length!==SOURCE.expectedCount) throw new Error('Ожидалось 395 наблюдений, получено '+parsed.length);
      useData(parsed,'full',csv);
      return;
    } catch(err) {console.info('Полный CSV не загружен из '+url+': '+err.message);}
  }
  if (!students.length) {$('data-status-text').textContent='Ошибка загрузки данных';$('data-status').className='data-state demo';}
}
function initialize() {
  for (const id of ['school-filter','sex-filter','study-filter','band-filter']) $(id).addEventListener('change',scheduleRender);
  $('absences-filter').addEventListener('input',()=>{$('absences-value').textContent=$('absences-filter').value;scheduleRender();});
  $('reset-filters').addEventListener('click',resetFilters);
  $('download-csv').addEventListener('click',downloadCSV);
  loadData();
}
initialize();
