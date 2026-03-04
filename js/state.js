// ════════════════════════════════════════════════════════════
//   DATA — STATE
// ════════════════════════════════════════════════════════════
// Application state object

// ═══ STATE ═══
const state = {
  step:0, type:'', fabric:'', color:'',
  sku: null, // SKU объект из SKU_CATALOG
  sizes:{'2XS':0,'XS':0,'S':0,'M':0,'L':0,'XL':0,'2XL':0,'3XL':0},
  customSizes:[],  // [{label:'4XL', qty:0}, ...]
  fit:'regular', fitChosen:false,
  extras:[],  // коды выбранных обработок из EXTRAS_CATALOG
  labels:[],  // коды выбранных лейблов из LABELS_CATALOG
  zones:[], tech:'screen', textileColor:'white', dtgTextile:'white',
  zoneTechs:{},
  zonePrints:{},
  dtgZones:{},
  embZones:{},
  dtfZones:{},
  zoneArtworks:{},
  designNotes:'', sizeComment:'', phone:'', messenger:'', file:null, zoneFiles:{}, generalFile:null, role:'manager', maxStep:0,
  name:'', contact:'', email:'', deadline:'', address:'', notes:'',
  labelOption:false, packOption:false, urgentOption:false,
  noPrint:false,
  labelConfig: {
    careLabel: {enabled:false, logoOption:'no-logo', composition:'', country:'', uploadData:null, comments:''},
    mainLabel: {option:'none', placement:'neck', material:'woven', color:'white', uploadData:null, comments:''},
    hangTag:   {option:'none', uploadData:null, comments:''}
  }
};




