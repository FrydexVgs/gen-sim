// ══════════════════════════════════════════════
//  STATE & VARIABLES
// ══════════════════════════════════════════════
const S = {
  examMode: true, // Por defecto en modo examen
  mode: 'off', engine: false, grid: false, checkDone: false,
  fault: false, fuel: 75, starting: false, stopping: false,
  autoStartT: null, autoStopT: null, gridLostAt: null, logStart: Date.now(),
  issuesFound: 0, timerStart: Date.now(), timerInt: null,
  // Valores iniciales de niveles, influenciados por ISSUES
  oilLevel: 0, // Se inicializa después de ISSUES
  coolantLevel: 0, // Se inicializa después de ISSUES
   fuelRand: 0, // Se inicializa después de ISSUES
  fuelWaterDrained: false,
  battVolt: 0, // Se inicializa después de ISSUES
  // NUEVAS VARIABLES DE REALISMO
  engineTemp: 25.0,
  oilPressure: 0,
  // --- ESTADO LOTO ---
  loto: {
    applied: false,
    batteryDisconnected: false,
    taggedBy: '',
    // Nuevos estados para el flujo LOTO
    notified: false, // Si el personal fue notificado por radio
    unlockNotified: false, // Si el personal fue notificado para desbloquear
    stage: 'identify', // 'identify', 'notify', 'shutdown', 'isolate', 'verify', 'unlock'
    verificationAttempted: false, // Si el usuario intentó arrancar para verificar energía cero
    energies: {
        mechanical: false,
        chemical: false,
        dc: false,
        ac: false,
        thermal: false
    }
  },
  engineHours: parseFloat((1234.5 + Math.random() * 100).toFixed(1)),
  // Variables de estado y físicas
  estop: false, loadPct: 0, actualV: 0, actualHz: 0, targetV: 0, targetHz: 0, overloadTimer: 0,
  crankingAttempts: 0,
  maintenanceAlarmTriggered: false,
  beltBreakTimer: null,
  beltBroken: false,
  lowOilPressureFault: false,
  highTempWarning: false,
  highTempFault: false,
  lowCoolantWarning: false,
  startFailure: false,
  fuelLeakRate: 0, // L/h adicional por fuga
  airFilterBlocked: false,
  radiatorBlocked: false,
  displayPage: 1, // 0:gen, 1:engine, 2:grid
  displayPages: ['gen', 'engine', 'grid'],
};

const NOMINAL_KW = 200; // 250 kVA * 0.8 PF

// Which zones randomly have issues
const ISSUES = {};
const possibleIssues = ['coolant','radiator','airfilter','exhaust','battery','belts','leaks','environment','breakers'];
possibleIssues.forEach(k => {
  if (Math.random() < 0.45) ISSUES[k] = true; // Slightly adjusted probability
});
// Force at least 3 issues to make it more interesting
const ikeys = Object.keys(ISSUES);
if (ikeys.length < 3) {
    const pool = possibleIssues.filter(k => !ISSUES[k]);
    while (Object.keys(ISSUES).length < 3 && pool.length > 0) {
        const randomIndex = Math.floor(Math.random() * pool.length);
        const issueToAdd = pool.splice(randomIndex, 1)[0];
        ISSUES[issueToAdd] = true;
    }
}

const fuelRng = Math.random();
if (fuelRng < 0.25) {
    ISSUES['fuel'] = 'water';
}

// Initialize S variables based on ISSUES
S.oilLevel = ISSUES['oil'] ? (15 + Math.random() * 18) : (62 + Math.random() * 32); // Low if issue, else normal
S.coolantLevel = ISSUES['coolant'] ? (18 + Math.random() * 20) : (65 + Math.random() * 28); // Low if issue, else normal
S.fuelRand = ISSUES['leaks'] ? (12 + Math.random() * 18) : (55 + Math.random() * 40); // Lower if leaks, else normal
S.fuel = ISSUES['leaks'] ? (12 + Math.random() * 18) : (55 + Math.random() * 40); // Lower if leaks, else normal
S.battVolt = ISSUES['battery'] ? (22.0 + Math.random() * 1.6) : (24.8 + Math.random() * 0.8); // Low if issue, else normal
S.airFilterBlocked = ISSUES['airfilter'];
S.radiatorBlocked = ISSUES['radiator'];
S.fuelLeakRate = ISSUES['leaks'] ? 5 + Math.random() * 5 : 0; // 5-10 L/h if leak issue

const NOMINAL_V = 277;
const NOMINAL_HZ = 60.0;
const AMBIENT_TEMP = 25.0;
const OPERATING_TEMP = 88.0;
const LOW_OIL_PRESSURE_THRESHOLD = 15; // PSI
const HIGH_TEMP_WARNING_THRESHOLD = 98; // °C
const HIGH_TEMP_FAULT_THRESHOLD = 105; // °C

const DONE = {}; // key -> 'ok' | 'issue'
let currentModal = null;

// Mapea los nombres de las mallas de tu archivo .glb a las claves internas del simulador.
// ¡OJO! El nombre debe ser EXACTO, incluyendo mayúsculas, tildes y espacios.
const MESH_TO_KEY_MAP = {
  'Entorno del Equipo': 'environment',
  'Inspeccion de Fugas': 'leaks',
  'Nivel de Aceite': 'oil',
  'Nivel de Refrigerante': 'coolant',
  'Nivel de Combustible': 'fuel',
  'Radiador y Ventilador': 'radiator',
  'Filtro de Aire': 'airfilter',
  'Sistema de Escape': 'exhaust',
  'Correas y Poleas': 'belts',
  'Bateria de Arranque': 'battery',
  'Breakers y Panel': 'breakers',
  // Si tienes una malla para LOTO, añádela aquí. Ej: 'Caja_LOTO': 'loto'
};


// ══════════════════════════════════════════════
//  CHECKLIST DATA
// ══════════════════════════════════════════════
const STEPS = [
  { key:'loto',        icon:'🔒', label:'Aislamiento y Bloqueo (LOTO)', sub:'Aislar y bloquear fuentes de energía' },
  { key:'environment', icon:'🧹', label:'Entorno del Equipo',      sub:'Verificar limpieza y obstrucciones en el área' },
  { key:'leaks',       icon:'💧', label:'Inspección de Fugas',     sub:'Buscar fugas de aceite, combustible y refrigerante' },
  { key:'oil',         icon:'🛢️', label:'Nivel de Aceite',         sub:'Extraer bayoneta y verificar nivel de aceite' },
  { key:'coolant',     icon:'🌡️', label:'Nivel de Refrigerante',   sub:'Verificar nivel en el tanque de expansión' },
  { key:'fuel',        icon:'⛽', label:'Nivel de Combustible',      sub:'Comprobar nivel diesel en tanque principal' },
  { key:'radiator',    icon:'💨', label:'Radiador y Ventilador',    sub:'Inspeccionar aletas, mangueras y ventilador' },
  { key:'airfilter',   icon:'🔍', label:'Filtro de Aire',           sub:'Verificar indicador y elemento filtrante' },
  { key:'exhaust',     icon:'🔧', label:'Sistema de Escape',        sub:'Revisar sujeciones, sellos y silenciador' },
  { key:'belts',       icon:'⚙️', label:'Correas y Poleas',         sub:'Tensión y estado de correas de transmisión' },
  { key:'battery',     icon:'🔋', label:'Batería de Arranque',      sub:'Verificar voltaje, limpieza y apriete' },
  { key:'breakers',    icon:'⚡', label:'Breakers y Panel',         sub:'Verificar breakers principal y de control' },
];

// ══════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════
function init() {
  document.body.classList.toggle('exam-mode', S.examMode);
  document.getElementById('exam-mode-switch').classList.toggle('on', S.examMode);
  renderSteps();
  startTimer();
  document.getElementById('d-hours').textContent = S.engineHours.toFixed(1);
  document.getElementById('d-batt').textContent = S.battVolt.toFixed(1); // Initial battery voltage
  updateDisplayPage();
  setupRadio();
  
  // Manejador de clics en el panel desenergizado (para Verificación de Energía Cero LOTO)
  document.getElementById('panel-deenergized').addEventListener('click', () => {
      if (S.loto.stage === 'verify' && !S.loto.verificationAttempted) {
          S.loto.verificationAttempted = true;
          elog('LOTO: Intento de arranque bloqueado. Verificación de energía cero exitosa.', 'ok');
          openModal('loto');
      } else if (S.loto.batteryDisconnected) {
          elog('El panel no responde. Batería desconectada.', 'warn');
      }
  });
  
  // Iniciar visor 3D clásico de Three.js
  setupThreeJSViewer();
}

function toggleExamMode() {
  S.examMode = !S.examMode;
  document.body.classList.toggle('exam-mode', S.examMode);
  document.getElementById('exam-mode-switch').classList.toggle('on', S.examMode);
}

// VARIABLES GLOBALES DE THREE.JS
let scene, camera, renderer, raycaster, mouse, controls, generadorModel;

function setupThreeJSViewer() {
    const container = document.getElementById('gen-viewer');
    if (!container) return;

    // 1. Escena y Cámara
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 100);
    
    // 2. Renderizador
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    // 3. Luces
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 10, 7);
    scene.add(directionalLight);

    // 4. Controles (OrbitControls)
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;

    // 5. Raycaster y Mouse (Como tú lo propusiste)
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    // 6. Cargar el Modelo .glb
    const loader = new THREE.GLTFLoader();
    loader.load('generador.glb', (gltf) => {
        generadorModel = gltf.scene;
        
        // Centrar y escalar automáticamente el modelo para que se vea perfecto
        const box = new THREE.Box3().setFromObject(generadorModel);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        
        generadorModel.position.sub(center); // Llevar al origen (0,0,0)
        scene.add(generadorModel);
        
        // Ajustar la cámara basada en el tamaño real del modelo
        const maxDim = Math.max(size.x, size.y, size.z);
        camera.position.set(maxDim, maxDim * 0.5, maxDim * 1.5);
        controls.target.set(0, 0, 0);
        
        console.log('✅ Three.js: Modelo cargado y centrado.');
        
        // Iniciar animación e interacción
        animate();
        setupThreeJSInteraction(container);

    }, undefined, (error) => {
        console.error('Error al cargar el modelo 3D:', error);
    });

    // ResizeObserver permite que el canvas se adapte dinámicamente si el grid o los paneles cambian de tamaño sin afectar el window
    const resizeObserver = new ResizeObserver(() => {
        if (container.clientWidth > 0) {
            camera.aspect = container.clientWidth / container.clientHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(container.clientWidth, container.clientHeight);
        }
    });
    resizeObserver.observe(container);
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}

function setupThreeJSInteraction(container) {
    // INTERACCIÓN DE HOVER (Cursor de Puntero)
    container.addEventListener('mousemove', (event) => {
        const rect = container.getBoundingClientRect();
        mouse.x = ((event.clientX - rect.left) / container.clientWidth) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / container.clientHeight) * 2 + 1;

        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(generadorModel.children, true);
        
        let isInteractive = false;
        if (intersects.length > 0) {
            let targetNode = intersects[0].object;
            while (targetNode) {
                // Reemplaza guiones bajos por espacios para asegurar la compatibilidad
                 let nombreNormalizado = (targetNode.name || '').replace(/_/g, ' ');
                if (MESH_TO_KEY_MAP[targetNode.name] || MESH_TO_KEY_MAP[nombreNormalizado]) {
                    isInteractive = true;
                    break;
                }
                targetNode = targetNode.parent;
            }
        }
        container.style.cursor = isInteractive ? 'pointer' : 'grab';
    });

    // INTERACCIÓN DE CLIC (El Raycaster Clásico que propusiste)
    container.addEventListener('click', (event) => {
        const rect = container.getBoundingClientRect();
        mouse.x = ((event.clientX - rect.left) / container.clientWidth) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / container.clientHeight) * 2 + 1;

        raycaster.setFromCamera(mouse, camera);
        const intersecciones = raycaster.intersectObjects(generadorModel.children, true);

        if (intersecciones.length > 0) {
            let targetNode = intersecciones[0].object;
            let key = null;
            let clickedMeshName = null;

            while (targetNode) {
                // Reemplaza guiones bajos por espacios para asegurar la compatibilidad
                 let nombreNormalizado = (targetNode.name || '').replace(/_/g, ' ');
                key = MESH_TO_KEY_MAP[targetNode.name] || MESH_TO_KEY_MAP[nombreNormalizado];
                if (key) {
                    clickedMeshName = targetNode.name;
                    break;
                }
                targetNode = targetNode.parent;
            }

            if (key) {
                console.log(`🎯 Clic exacto en malla: '${clickedMeshName}', abriendo modal: '${key}'`);
                if (DONE[key] && key !== 'loto') {
                    elog(`La zona '${STEPS.find(s => s.key === key).label}' ya fue inspeccionada.`, 'sys');
                    return;
                }
                openModal(key);
            } else {
                console.log(`Clic en la malla no interactiva: '${intersecciones[0].object.name}'`);
            }
        } else {
            console.log('Clic en el fondo.');
        }
    });
}

// NUEVO: Lógica del Radio
function setupRadio() {
    const pttBtn = document.getElementById('radio-ptt-btn');
    const transmitMsg = document.getElementById('radio-transmit-msg');
    const radioDesc = document.getElementById('radio-status-desc');

    const startTransmit = (e) => {
        e.preventDefault();
        // No transmitir si ya se notificó para la etapa actual (bloqueo o desbloqueo)
        if ((!S.loto.applied && S.loto.notified) || (S.loto.applied && S.loto.unlockNotified)) {
            return;
        }
        transmitMsg.style.display = 'block';
        pttBtn.classList.add('active');
    };

    const endTransmit = (e) => {
        e.preventDefault();
        if ((!S.loto.applied && S.loto.notified) || (S.loto.applied && S.loto.unlockNotified)) {
            return;
        }
        transmitMsg.style.display = 'none';
        pttBtn.classList.remove('active');

        if (S.loto.applied) { // Procedimiento de DESBLOQUEO
            S.loto.unlockNotified = true;
            elog('📡 NOTIFICACIÓN: Se ha informado al personal sobre el DESBLOQUEO del equipo.', 'info');
            pttBtn.classList.add('done');
            pttBtn.querySelector('span').textContent = '✅ DESBLOQUEO NOTIFICADO';
            radioDesc.textContent = 'El personal ha sido notificado. Puede proceder con el desbloqueo.';
            radioDesc.style.color = 'var(--green)';
            if (currentModal === 'loto') {
                openModal('loto'); // Re-render para habilitar botón de desbloqueo
            }
        } else { // Procedimiento de BLOQUEO
            S.loto.notified = true;
            elog('📡 NOTIFICACIÓN: Se ha informado al personal sobre el bloqueo del equipo.', 'info');
            pttBtn.classList.add('done');
            pttBtn.querySelector('span').textContent = '✅ PERSONAL NOTIFICADO';
            radioDesc.textContent = 'El personal ha sido notificado. Puede proceder con el LOTO.';
            radioDesc.style.color = 'var(--green)';
        }
    };

    pttBtn.addEventListener('mousedown', startTransmit);
    pttBtn.addEventListener('mouseup', endTransmit);
    pttBtn.addEventListener('mouseleave', () => { if (!pttBtn.classList.contains('done')) transmitMsg.style.display = 'none'; });
    pttBtn.addEventListener('touchstart', startTransmit, { passive: false });
    pttBtn.addEventListener('touchend', endTransmit);
}

function startTimer() {
  S.timerInt = setInterval(() => {
    if (S.checkDone) return;
    const elapsed = Math.floor((Date.now() - S.timerStart) / 1000);
    const m = String(Math.floor(elapsed/60)).padStart(2,'0');
    const s = String(elapsed%60).padStart(2,'0');
    document.getElementById('sc-time').textContent = m+':'+s;
  }, 1000);
}

function renderSteps() {
  const container = document.getElementById('cl-right');
  const complete = document.getElementById('complete-card');
  container.innerHTML = '';
  container.appendChild(complete);

  STEPS.forEach((st, i) => {
    const card = document.createElement('div');
    card.className = 'step-card fadeup';
    card.id = 'sc-'+st.key;
    card.style.animationDelay = (i*0.05)+'s';

    const didact = getDidact(st.key);

    card.innerHTML = `
      <div class="step-hdr" onclick="toggleStep('${st.key}')">
        <div class="step-num" id="sn-${st.key}">${i+1}</div>
        <div class="step-info">
          <div class="step-title">${st.icon} ${st.label}</div>
          <div class="step-sub" id="ss-${st.key}">${st.sub}</div>
        </div>
        <div class="step-arrow">▶</div>
      </div>
      <div class="step-body" id="sb-${st.key}">
        ${didact}
        <button class="inspect-btn" id="ibtn-${st.key}" onclick="openModal('${st.key}')">
          🔍 Inspeccionar ${st.label}
        </button>
      </div>
    `;
    container.insertBefore(card, complete);
  });
}

function getDidact(key) {
  const map = {
    oil: `<div class="didact-box">
      <div class="db-title">📖 ¿Por qué revisar el aceite?</div>
      El aceite lubrica todas las partes móviles del motor. Un nivel bajo puede causar <strong>desgaste acelerado, sobrecalentamiento y daño irreparable</strong> al motor.
      <ul class="db-list" style="margin-top:6px">
        <li>Nivel debe estar <strong>entre MIN y MAX</strong> en la bayoneta</li>
        <li>El aceite debe verse limpio (ámbar oscuro), no negro lechoso</li>
        <li>Revisar <strong>en frío</strong>, con el motor apagado al menos 5 min</li>
      </ul>
    </div>`,
    coolant: `<div class="didact-box">
      <div class="db-title">📖 Sistema de Refrigeración</div>
      El refrigerante mantiene la temperatura del motor entre 75-95°C. Sin él, el motor puede <strong>alcanzar 300°C en minutos</strong>.
      <ul class="db-list" style="margin-top:6px">
        <li>Verificar en el depósito de expansión (translúcido)</li>
        <li>El líquido debe verse <strong>verde/azul</strong>, nunca turbio o con partículas</li>
        <li>⚠️ Jamás abrir la tapa con el motor caliente (presión)</li>
      </ul>
    </div>`,
    fuel: `<div class="didact-box">
      <div class="db-title">📖 Combustible Diesel</div>
      El diesel es el único combustible del grupo. Quedarse sin combustible requiere <strong>purgar el sistema de inyección</strong>, proceso complejo.
      <ul class="db-list" style="margin-top:6px">
        <li>Mínimo recomendado para arrancar: <strong>20% de capacidad</strong></li>
        <li>Verificar que no haya agua en el separador de combustible</li>
        <li>Consumo típico 250 kVA: ~50 L/hora a plena carga</li>
      </ul>
    </div>`,
    radiator: `<div class="didact-box">
      <div class="db-title">📖 Radiador y Ventilador</div>
      El radiador disipa el calor del refrigerante al aire. Las aletas obstruidas reducen la eficiencia hasta un <strong>60%</strong>.
      <ul class="db-list" style="margin-top:6px">
        <li>Verificar que las aletas estén limpias y sin objetos extraños</li>
        <li>Revisar que el ventilador gire libremente sin ruidos</li>
        <li>Inspeccionar mangueras: sin grietas, bultos ni fugas</li>
      </ul>
    </div>`,
    airfilter: `<div class="didact-box">
      <div class="db-title">📖 Filtro de Aire</div>
      El motor consume <strong>~4 m³ de aire por minuto</strong>. Un filtro obstruido causa humo negro, pérdida de potencia y mayor consumo de combustible.
      <ul class="db-list" style="margin-top:6px">
        <li>Verificar indicador de restricción si está instalado</li>
        <li>El elemento debe verse sin rasgaduras que permitan paso de polvo</li>
        <li>Reemplazar según horas de operación o indicador visual</li>
      </ul>
    </div>`,
    exhaust: `<div class="didact-box">
      <div class="db-title">📖 Sistema de Escape</div>
      Los gases de escape contienen <strong>CO (monóxido de carbono)</strong>, gas inodoro y letal. Una fuga es una emergencia de seguridad.
      <ul class="db-list" style="margin-top:6px">
        <li>Verificar que todas las abrazaderas estén apretadas</li>
        <li>Buscar rastros de hollín negro (indica fuga)</li>
        <li>El silenciador no debe vibrar ni tener fisuras visibles</li>
      </ul>
    </div><div class="didact-box warn">
      <div class="db-title">⚠️ Seguridad</div>
      Nunca operar el equipo en espacios cerrados o con escape dañado. Los gases de escape son causa de muertes silenciosas.
    </div>`,
    battery: `<div class="didact-box">
      <div class="db-title">📖 Batería de Arranque 24V</div>
      La batería alimenta el motor de arranque (>200A al cranking) y los circuitos de control del controlador.
      <ul class="db-list" style="margin-top:6px">
        <li><strong>25.2V = cargada | 24.0V = 50% | &lt;23.6V = descargada</strong></li>
        <li>Terminales limpias sin sulfato blanco (corrosión)</li>
        <li>Verificar que los cables de conexión estén apretados</li>
      </ul>
    </div>`,
    belts: `<div class="didact-box">
      <div class="db-title">📖 Correas Serpentina / V</div>
      Las correas transmiten movimiento del cigüeñal al alternador de carga, bomba de agua y compresor.
      <ul class="db-list" style="margin-top:6px">
        <li>Tensión correcta: deflexión de <strong>1-1.5 cm</strong> al presionar</li>
        <li>Buscar grietas, deshilachamiento o superficies brillosas (deslizamiento)</li>
        <li>Una correa rota detiene el motor por sobrecalentamiento</li>
      </ul>
    </div>`,
    leaks: `<div class="didact-box">
      <div class="db-title">📖 Inspección de Fugas</div>
      Las fugas son el indicio más común de un problema inminente. Deben identificarse y corregirse antes del arranque.
      <ul class="db-list" style="margin-top:6px">
        <li><strong>Aceite:</strong> Charcos negros/marrones bajo el motor. Indica sellos o juntas dañadas.</li>
        <li><strong>Refrigerante:</strong> Charcos verdes/azules/rosas. Indica mangueras, radiador o bomba de agua con fugas.</li>
        <li><strong>Combustible:</strong> Olor a diesel y manchas húmedas en líneas. Riesgo de incendio.</li>
      </ul>
    </div>`,
    environment: `<div class="didact-box">
      <div class="db-title">📖 Entorno del Cuarto de Máquinas</div>
      Un entorno limpio y ordenado es crucial para la seguridad y el correcto funcionamiento del generador.
      <ul class="db-list" style="margin-top:6px">
        <li>El área debe estar <strong>libre de obstrucciones</strong> que impidan el acceso o la ventilación.</li>
        <li>No almacenar materiales inflamables (trapos con aceite, solventes) cerca del equipo.</li>
        <li>Verificar que la iluminación de emergencia y extintores (Tipo ABC) estén accesibles.</li>
      </ul>
    </div>`,
    breakers: `<div class="didact-box">
      <div class="db-title">📖 Breakers de Protección</div>
      Son los interruptores automáticos que protegen el equipo de sobrecargas y cortocircuitos.
      <ul class="db-list" style="margin-top:6px">
        <li><strong>Breaker Principal:</strong> Protege el alternador. Debe estar en 'ON' o 'CERRADO' para generar.</li>
        <li><strong>Breaker de Control:</strong> Protege los circuitos del controlador (12V DC). Debe estar en 'ON'.</li>
        <li>Un breaker disparado ('TRIPPED' o en posición media) indica una falla que debe investigarse.</li>
      </ul>
    </div>`,
  };
  return map[key] || '';
}

function toggleStep(key) {
  const card = document.getElementById('sc-'+key);
  const isOpen = card.classList.contains('expanded');
  document.querySelectorAll('.step-card.expanded').forEach(c => c.classList.remove('expanded'));
  if (!isOpen) card.classList.add('expanded');
}

// ══════════════════════════════════════════════
//  MODALS
// ══════════════════════════════════════════════
function openModal(key) {
  // Reset LOTO progress if modal is closed and reopened without completion
  // Si el LOTO ya está aplicado, al abrir el modal siempre será para desbloquear
  if (key === 'loto' && S.loto.applied) {
      S.loto.stage = 'unlock'; // Set a stage for the unlock view
  }
  currentModal = key;
  const box = document.getElementById('modal-box');
  box.innerHTML = buildModal(key);
  document.getElementById('modal-overlay').classList.add('open');
  afterModalOpen(key);
}

function cancelLotoProcedure() {
    elog('LOTO: Procedimiento de bloqueo cancelado por el usuario.', 'warn');
    // Si la batería fue desconectada, la reconectamos al cancelar.
    if (S.loto.batteryDisconnected) {
        document.getElementById('panel-deenergized').style.display = 'none';
        elog('LOTO: Panel re-energizado.', 'info');
    }
    // Reseteo completo del estado de LOTO
    S.loto.stage = 'identify';
    Object.keys(S.loto.energies).forEach(k => S.loto.energies[k] = false);
    S.loto.verificationAttempted = false;
    S.loto.batteryDisconnected = false;
    S.loto.taggedBy = '';
    S.loto.notified = false;
    S.loto.unlockNotified = false;
    
    // Reset radio UI
    const pttBtn = document.getElementById('radio-ptt-btn');
    const radioDesc = document.getElementById('radio-status-desc');
    if (pttBtn) {
        pttBtn.classList.remove('done');
        pttBtn.querySelector('span').textContent = 'PULSADOR (PTT)';
    }
    if (radioDesc) {
        radioDesc.textContent = 'Notifique al personal antes de iniciar procedimientos de bloqueo.';
        radioDesc.style.color = 'var(--dim)';
    }

    closeModal();
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
  currentModal = null;
}

// CORREGIDO: El listener para cerrar el modal al hacer clic fuera de él
document.getElementById('modal-overlay').addEventListener('click', function(e) {
    if (e.target === this) {
        // Al hacer clic fuera, solo cerramos el modal sin resetear el progreso.
        closeModal();
    }
});

function buildModal(key) {
  const builders = {
    oil: buildOil, coolant: buildCoolant, fuel: buildFuel, radiator: buildRadiator, airfilter: buildAirfilter, exhaust: buildExhaust, battery: buildBattery, belts: buildBelts, loto: buildLoto, leaks: buildLeaks, environment: buildEnvironment, breakers: buildBreakers
  };
  return builders[key] ? builders[key]() : '';
}

// ─── OIL ───
function buildOil() {
  const lvl = S.oilLevel;
  const isOk = lvl >= 35 && lvl <= 92;
  const fillH = Math.round(lvl * 2); // 0-200px
  const fillPct = Math.min(100, Math.round(lvl));
  const ptrTop = Math.round(220 - (lvl/100)*160) - 7;

  let zoneLabel, zoneCls, msg, btnColor;
  if (lvl < 35) {
    zoneLabel = 'POR DEBAJO DEL MÍNIMO'; zoneCls='low'; btnColor='btn-amber';
    msg = 'El nivel de aceite está críticamente bajo. <strong>OBLIGATORIO</strong> agregar aceite antes de arrancar. Operar en estas condiciones causará daño permanente al motor en minutos.';
  } else if (lvl > 92) {
    zoneLabel = 'POR ENCIMA DEL MÁXIMO'; zoneCls='low'; btnColor='btn-amber';
    msg = 'Nivel excesivo de aceite. El exceso puede ser arrastrado por el turbo y quemarse, causando humo azul y daño a sellos. Drenar el exceso.';
  } else {
    zoneLabel = 'ENTRE MIN Y MAX — CORRECTO'; zoneCls='good'; btnColor='btn-green';
    msg = 'Nivel de aceite dentro del rango óptimo de operación. El aceite se ve limpio y sin contaminantes. ✅ Sin acción requerida.';
  }

  return `
  <div class="modal-hdr">
    <div class="modal-icon">🛢️</div>
    <div>
      <div class="modal-title" style="color:var(--cyan)">BAYONETA DE ACEITE</div>
      <div style="font-size:0.75rem;color:var(--dim);margin-top:3px">Motor Diesel · Carter de aceite · 6 cilindros</div>
    </div>
  </div>
  <div class="modal-body">
    <div class="dipstick-wrap">
      <div style="position:relative">
        <div class="dipstick" style="height:220px">
          <div class="dipstick-oil" id="dp-fill" style="height:0%;transition:height 1.2s ease"></div>
          <div class="dipstick-mark max" data-label="MAX"></div>
          <div class="dipstick-mark min" data-label="MIN"></div>
        </div>
        <div class="dipstick-pointer" id="dp-ptr" style="top:${ptrTop}px;left:0"></div>
      </div>
      <div class="dipstick-info">
        <div class="di-level" style="color:${isOk?'var(--green)':'var(--red)'}">${fillPct}%</div>
        <div class="di-zone" style="background:${isOk?'#00e87a11':'#ff2d4411'};color:${isOk?'var(--green)':'var(--red)'};border:1px solid ${isOk?'#00e87a33':'#ff2d4433'}">${zoneLabel}</div>
        <div class="di-desc">${msg}</div>
      </div>
    </div>
    <div class="didact-box" style="margin-top:4px">
      <div class="db-title">Viscosidad recomendada</div>
      SAE 15W-40 API CI-4 o superior para motores diesel. Cambio cada <strong>250 horas</strong> de operación o anualmente.
    </div>
  </div>
  <div class="modal-footer">
    <button class="btn-primary ${btnColor}" onclick="completeZone('oil')" style="flex:1">
      ${isOk ? '✅ Nivel OK — Continuar' : `⚠️ Registrar y programar mantenimiento`}
    </button>
    <button class="btn-primary" onclick="closeModal()" style="flex:0.4;background:var(--bg2);border:1px solid var(--border2);color:var(--dim)">Cancelar</button>
  </div>`;
}

// ─── COOLANT ───
function buildCoolant() {
  const lvl = S.coolantLevel;
  const hasIssue = ISSUES['coolant'];
  const displayLvl = hasIssue ? Math.min(lvl, 28) : Math.max(lvl, 62);
  const isOk = displayLvl >= 40;
  const fillH = Math.round(displayLvl); // percentage

  return `
  <div class="modal-hdr">
    <div class="modal-icon">🌡️</div>
    <div>
      <div class="modal-title" style="color:var(--cyan)">SISTEMA DE REFRIGERACIÓN</div>
      <div style="font-size:0.75rem;color:var(--dim);margin-top:3px">Depósito de expansión · Nivel de refrigerante</div>
    </div>
  </div>
  <div class="modal-body">
    <div style="display:flex;gap:20px;align-items:flex-start;margin-bottom:14px">
      <div style="text-align:center;flex-shrink:0">
        <div style="position:relative;display:inline-block">
          <div class="coolant-tank">
            <div class="coolant-cap"></div>
            <div class="coolant-fill" id="ct-fill" style="height:0%;transition:height 1.2s ease"></div>
            <div class="coolant-mark" style="top:20%">MAX</div>
            <div class="coolant-mark" style="top:60%">MIN</div>
          </div>
        </div>
        <div style="font-size:0.7rem;color:var(--dim);margin-top:8px;font-family:'Share Tech Mono',monospace">DEPÓSITO</div>
      </div>
      <div style="flex:1">
        <div style="font-family:'Orbitron',monospace;font-size:1.8rem;font-weight:900;color:${isOk?'var(--green)':'var(--red)'};margin-bottom:4px">${Math.round(displayLvl)}%</div>
        <div style="padding:4px 12px;border-radius:12px;font-size:0.78rem;font-weight:700;display:inline-block;margin-bottom:10px;background:${isOk?'#00e87a11':'#ff2d4411'};border:1px solid ${isOk?'#00e87a33':'#ff2d4433'};color:${isOk?'var(--green)':'var(--red)'}">
          ${isOk ? 'NIVEL CORRECTO' : '⚠ NIVEL BAJO — REQUIERE ATENCIÓN'}
        </div>
        ${hasIssue ? `
        <div class="anomaly-scene" style="text-align:left;padding:10px">
          <div style="color:var(--red);font-weight:700;font-size:0.82rem;margin-bottom:6px">🚨 ANOMALÍA DETECTADA</div>
          <div style="font-size:0.78rem;color:var(--dim);line-height:1.5">El nivel de refrigerante está por debajo del mínimo. Posible causa: fuga en manguera, radiador o bomba de agua. Agregar refrigerante <strong>Tipo AF/SF</strong> o mezcla 50/50 agua destilada + anticongelante.</div>
        </div>` : `<div style="font-size:0.8rem;color:var(--dim);line-height:1.5">Nivel de refrigerante dentro del rango operativo. Liquido de color verde/azul translúcido, sin partículas ni turbidez. ✅</div>`}
      </div>
    </div>
    <div class="didact-box warn" style="${hasIssue?'display:block':'display:none'}">
      <div class="db-title">⚠️ Procedimiento de llenado</div>
      Esperar que el motor esté FRÍO. Abrir tapa lentamente. Agregar hasta la marca MAX. Nunca usar agua de llave (minerales obstruyen el sistema).
    </div>
  </div>
  <div class="modal-footer">
    ${hasIssue ?
      `<button class="btn-primary btn-amber" onclick="completeZone('coolant',true)" style="flex:1" ${!S.loto.applied ? 'disabled' : ''}>
        ${!S.loto.applied ? '🔒 Requiere LOTO para intervenir' : '⚠️ Agregar refrigerante y registrar'}
       </button>` :
      `<button class="btn-primary btn-green" onclick="completeZone('coolant')" style="flex:1">✅ Nivel OK — Continuar</button>`
    }
    <button class="btn-primary" onclick="closeModal()" style="flex:0.4;background:var(--bg2);border:1px solid var(--border2);color:var(--dim)">Cancelar</button>
  </div>`;
}

// ─── FUEL ───
function buildFuel() {
  const lvl = S.fuel;
  const isLow = lvl < 25;
  const fillW = Math.round(lvl);
  const hasWaterIssue = ISSUES['fuel'] === 'water';

  const separatorHtml = hasWaterIssue ? `
  <div class="fuel-separator">
      <div class="separator-title">SEPARADOR DE AGUA/COMBUSTIBLE</div>
      <div class="separator-body">
          <div class="separator-water" id="separator-water-level" style="height: ${S.fuelWaterDrained ? '0%' : '40%'}"></div>
      </div>
      ${!S.fuelWaterDrained ? `
      <div style="font-size:0.75rem; color:var(--amber); margin-top:8px;">⚠ Agua detectada en el fondo.</div>
      <button class="btn-primary btn-red" style="padding: 8px 16px; font-size: 0.8rem; margin-top: 10px;" onclick="drainFuelWater()" ${!S.loto.applied ? 'disabled' : ''}>${!S.loto.applied ? '🔒 REQUIERE LOTO' : 'DRENAR AGUA'}</button>
      ` : `
      <div style="font-size:0.75rem; color:var(--green); margin-top:8px;">✅ Separador drenado.</div>
      `}
  </div>
  ` : '';

  const actionButton = hasWaterIssue ? 
    `<button class="btn-primary btn-amber" onclick="completeZone('fuel',true)" style="flex:1" ${!S.fuelWaterDrained || !S.loto.applied ? 'disabled' : ''}>${!S.loto.applied ? '🔒 Requiere LOTO para intervenir' : (S.fuelWaterDrained ? '✅ Registrar Drenaje' : 'Drenaje Requerido')}</button>` :
    isLow ? `<button class="btn-primary btn-amber" onclick="completeZone('fuel',true)" style="flex:1" ${!S.loto.applied ? 'disabled' : ''}>${!S.loto.applied ? '🔒 Requiere LOTO para intervenir' : '⚠️ Solicitar recarga — Registrar'}</button>` :
    `<button class="btn-primary btn-green" onclick="completeZone('fuel')" style="flex:1">✅ Combustible OK — Continuar</button>`;

  return `
  <div class="modal-hdr">
    <div class="modal-icon">⛽</div>
    <div>
      <div class="modal-title" style="color:var(--cyan)">NIVEL DE COMBUSTIBLE</div>
      <div style="font-size:0.75rem;color:var(--dim);margin-top:3px">Tanque principal diesel · 500 litros de capacidad</div>
    </div>
  </div>
  <div class="modal-body">
    <div style="margin-bottom:16px">
      <div style="font-family:'Orbitron',monospace;font-size:2.5rem;font-weight:900;color:${isLow?'var(--red)':lvl<40?'var(--amber)':'var(--green)'};text-align:center;margin-bottom:4px">${Math.round(lvl)}%</div>
      <div class="fuel-visual">
        <div class="fuel-fill" id="ff-fill" style="width:0%;background:${isLow?'var(--red)':lvl<40?'var(--amber)':'var(--green)'}"></div>
        <div class="fuel-needle" style="left:0%" id="ff-needle"></div>
        <div class="fuel-pct-badge">${Math.round(lvl * 5)} L</div>
      </div>
      <div class="fuel-labels">
        <span>0 L</span>
        <span style="color:var(--red)">25% MÍNIMO</span>
        <span>500 L</span>
      </div>
    </div>
    ${isLow ? `
    <div class="anomaly-scene">
      <div class="anomaly-emoji">⛽</div>
      <div class="anomaly-title">NIVEL CRÍTICO DE COMBUSTIBLE</div>
      <div class="anomaly-desc">Con menos del 25% el aire puede entrar al sistema de inyección si el equipo se inclina. Además, una operación prolongada sin combustible requiere purga completa del sistema.</div>
    </div>` : `
    <div class="didact-box">
      <div class="db-title">Estimación de autonomía</div>
      Con ${Math.round(lvl*5)} litros y consumo típico de <strong>50 L/h a plena carga</strong>, la autonomía estimada es de <strong>${Math.round(lvl*5/50)} horas</strong>. Se recomienda mantener siempre más del 25%.
    </div>`}
    ${separatorHtml}
  </div>
  <div class="modal-footer">
    ${actionButton}
    <button class="btn-primary" onclick="closeModal()" style="flex:0.4;background:var(--bg2);border:1px solid var(--border2);color:var(--dim)">Cancelar</button>
  </div>`;
}

function drainFuelWater() {
    S.fuelWaterDrained = true;
    const waterLevel = document.getElementById('separator-water-level');
    if (waterLevel) {
        waterLevel.style.height = '0%';
    }
    // Re-render the modal to update the button and text
    const box = document.getElementById('modal-box');
    box.innerHTML = buildFuel();
    // Re-attach animations/interactions if needed
    afterModalOpen('fuel');
}

// ─── RADIATOR ───
function buildRadiator() {
  const hasIssue = ISSUES['radiator'];
  
  if (hasIssue) {
    const blocked = [2,3,4,7,8];
    let finsHtml = '';
    for (let i=0; i<12; i++) {
      finsHtml += `<div class="rad-fin${blocked.includes(i)?' blocked':''}"></div>`;
    }
    const debrisX = 35 + Math.random() * 20;
    const debrisY = 20 + Math.random() * 30;

    return `
    <div class="modal-hdr"><div class="modal-icon">💨</div><div><div class="modal-title" style="color:var(--cyan)">RADIADOR Y VENTILADOR</div><div style="font-size:0.75rem;color:var(--dim);margin-top:3px">Sistema de enfriamiento · Aletas de disipación</div></div></div>
    <div class="modal-body">
      <div class="anomaly-scene" style="text-align:left">
        <div class="anomaly-emoji" style="float:left; margin-right:12px">⚠️</div>
        <div class="anomaly-title">OBSTRUCCIÓN EN RADIADOR</div>
        <div class="anomaly-desc">Se detectó una bolsa de plástico. <strong>Pasa el cursor repetidamente sobre la obstrucción</strong> para retirarla y limpiar las aletas.</div>
      </div>
      <div class="rad-clean-wrap">
        <div class="rad-visual-interactive">
          ${finsHtml}
          <div class="rad-obstruct-interactive" id="rad-debris" style="top:${debrisY}%;left:${debrisX}%;">🛍️</div>
        </div>
        <div class="clean-prog-wrap">
            <div class="clean-prog-lbl">PROGRESO DE LIMPIEZA</div>
            <div class="clean-prog-track"><div class="clean-prog-fill" id="rad-clean-bar"></div></div>
        </div>
      </div>
      <div class="fix-steps">
        <div class="fix-step"><div class="fix-step-num">1</div><div class="fix-step-txt">Asegurarse de que el motor esté <strong>apagado y frío</strong>.</div></div>
        <div class="fix-step"><div class="fix-step-num">2</div><div class="fix-step-txt">Retirar el objeto con cuidado, sin doblar las aletas del radiador.</div></div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn-primary btn-amber" id="rad-fix-btn" onclick="completeZone('radiator',true)" style="flex:1" disabled>🛍️ Registrar Limpieza</button>
      <button class="btn-primary" onclick="closeModal()" style="flex:0.4;background:var(--bg2);border:1px solid var(--border2);color:var(--dim)">Cancelar</button>
    </div>`;
  } else {
    // No issue case
    let finsHtml = '';
    for (let i=0; i<12; i++) {
      finsHtml += `<div class="rad-fin"></div>`;
    }
    return `
    <div class="modal-hdr"><div class="modal-icon">💨</div><div><div class="modal-title" style="color:var(--cyan)">RADIADOR Y VENTILADOR</div><div style="font-size:0.75rem;color:var(--dim);margin-top:3px">Sistema de enfriamiento · Aletas de disipación</div></div></div>
    <div class="modal-body">
      <div style="margin-bottom:12px;font-size:0.82rem;color:var(--dim)">Vista frontal del núcleo del radiador:</div>
      <div class="rad-visual" id="rad-vis">
        ${finsHtml}
      </div>
      <div class="didact-box">
        <div class="db-title">Estado del radiador</div>
        Aletas limpias y sin obstrucciones. Mangueras superior e inferior en buen estado, sin grietas ni ablandamiento. Ventilador gira libremente. ✅
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn-primary btn-green" onclick="completeZone('radiator')" style="flex:1">✅ Radiador OK — Continuar</button>
      <button class="btn-primary" onclick="closeModal()" style="flex:0.4;background:var(--bg2);border:1px solid var(--border2);color:var(--dim)">Cancelar</button>
    </div>`;
  }
}

// ─── AIR FILTER ───
function buildAirfilter() {
  const hasIssue = ISSUES['airfilter'];
  const cond = hasIssue ? 'blocked' : 'clean';
  const condLabel = hasIssue ? '🔴 OBSTRUIDO / CONTAMINADO' : '🟢 LIMPIO — BUEN ESTADO';
  const condIcon = hasIssue ? '🐛' : '✅';

  return `
  <div class="modal-hdr">
    <div class="modal-icon">🔍</div>
    <div>
      <div class="modal-title" style="color:var(--cyan)">FILTRO DE AIRE</div>
      <div style="font-size:0.75rem;color:var(--dim);margin-top:3px">Elemento filtrante · Admisión de aire al motor</div>
    </div>
  </div>
  <div class="modal-body">
    <div class="airfilter-visual">
      <div class="filter-element ${cond}">${condIcon}</div>
      <div class="filter-text" style="color:${hasIssue?'var(--red)':'var(--green)'}; font-weight:700">${condLabel}</div>
    </div>
    ${hasIssue ? `
    <div class="anomaly-scene">
      <div class="anomaly-emoji">🪲</div>
      <div class="anomaly-title">FILTRO OBSTRUIDO — NIDO DE INSECTOS</div>
      <div class="anomaly-desc">El elemento filtrante presenta acumulación de polvo excesivo y presencia de nido de insectos en la sección de entrada. La restricción de aire causará rica mezcla, humo negro y pérdida de hasta 30% de potencia.</div>
    </div>
    <div class="fix-steps">
      <div class="fix-step"><div class="fix-step-num">1</div><div class="fix-step-txt">Retirar el elemento del cuerpo del filtro</div></div>
      <div class="fix-step"><div class="fix-step-num">2</div><div class="fix-step-txt">Si el polvo es leve: sopletear suavemente de adentro hacia afuera</div></div>
      <div class="fix-step"><div class="fix-step-num">3</div><div class="fix-step-txt">Si hay nido, grietas o aceite: <strong>reemplazar el elemento</strong> — no puede limpiarse</div></div>
      <div class="fix-step"><div class="fix-step-num">4</div><div class="fix-step-txt">Verificar que el sello del cuerpo no tenga fugas de polvo</div></div>
    </div>` : `
    <div class="didact-box">
      <div class="db-title">Estado del filtro</div>
      El elemento filtrante está en buen estado, sin rasgaduras ni contaminación excesiva. Sello del cuerpo íntegro. Indicador de restricción en zona verde. ✅
    </div>
    <div class="didact-box" style="margin-top:8px">
      <div class="db-title">Intervalo de reemplazo</div>
      Cada <strong>500 horas</strong> de operación o antes si el indicador entra en zona roja. En ambientes polvorientos reducir a 250 h.
    </div>`}
  </div>
  <div class="modal-footer">
    ${hasIssue ?
      `<button class="btn-primary btn-amber" onclick="completeZone('airfilter',true)" style="flex:1" ${!S.loto.applied ? 'disabled' : ''}>
        ${!S.loto.applied ? '🔒 Requiere LOTO para intervenir' : '🔧 Reemplazar elemento filtrante'}
       </button>` :
      `<button class="btn-primary btn-green" onclick="completeZone('airfilter')" style="flex:1">✅ Filtro OK — Continuar</button>`
    }
    <button class="btn-primary" onclick="closeModal()" style="flex:0.4;background:var(--bg2);border:1px solid var(--border2);color:var(--dim)">Cancelar</button>
  </div>`;
}

// ─── EXHAUST ───
function buildExhaust() {
  const hasIssue = ISSUES['exhaust'];
  return `
  <div class="modal-hdr">
    <div class="modal-icon">🔧</div>
    <div>
      <div class="modal-title" style="color:var(--cyan)">SISTEMA DE ESCAPE</div>
      <div style="font-size:0.75rem;color:var(--dim);margin-top:3px">Tuberías · Abrazaderas · Silenciador · Sellado</div>
    </div>
  </div>
  <div class="modal-body">
    <div class="exhaust-visual">
      <div style="font-size:0.7rem;color:var(--dim);margin-bottom:8px;font-family:'Share Tech Mono',monospace">VISTA LATERAL — SISTEMA DE ESCAPE</div>
      <div class="pipe" style="margin-left:0;width:80%">
        <div class="pipe-clamp" style="left:15%"></div>
        <div class="pipe-clamp ${hasIssue?'loose':''}" style="left:45%" title="${hasIssue?'SUELTA':'OK'}"></div>
        <div class="pipe-clamp" style="left:75%"></div>
        <span style="position:absolute;right:8px;top:50%;transform:translateY(-50%);font-size:0.65rem;font-family:'Share Tech Mono',monospace;color:var(--dim)">→ SILENCIADOR</span>
      </div>
      ${hasIssue?`<div style="text-align:center;margin-top:4px;font-size:0.75rem;color:var(--amber)">⚠ Abrazadera central SUELTA — rastro de hollín</div>`:'<div style="text-align:center;margin-top:4px;font-size:0.75rem;color:var(--green)">✅ Todas las abrazaderas apretadas</div>'}
    </div>
    ${hasIssue ? `
    <div class="anomaly-scene">
      <div class="anomaly-emoji">⚠️</div>
      <div class="anomaly-title">ABRAZADERA DE ESCAPE SUELTA</div>
      <div class="anomaly-desc">Se detectó una abrazadera completamente suelta con rastros de hollín negro indicando fuga activa de gases. El CO (monóxido de carbono) es inodoro y mortal. Riesgo crítico de seguridad.</div>
    </div>
    <div class="fix-steps">
      <div class="fix-step"><div class="fix-step-num">1</div><div class="fix-step-txt">Motor apagado y sistema completamente frío (espera mínimo <strong>2 horas</strong>)</div></div>
      <div class="fix-step"><div class="fix-step-num">2</div><div class="fix-step-txt">Apretar la abrazadera con llave de tubo, verificar par de apriete especificado</div></div>
      <div class="fix-step"><div class="fix-step-num">3</div><div class="fix-step-txt">Limpiar el hollín y verificar que la junta de escape no esté dañada</div></div>
      <div class="fix-step"><div class="fix-step-num">4</div><div class="fix-step-txt">Después del primer arranque, verificar nuevamente en caliente con detector de CO</div></div>
    </div>` : `
    <div class="didact-box">
      <div class="db-title">Estado del sistema de escape</div>
      Todas las abrazaderas apretadas sin rastros de hollín. Silenciador sin fisuras. Sistema en condición segura de operación. ✅
    </div>`}
  </div>
  <div class="modal-footer">
    ${hasIssue ?
      `<button class="btn-primary btn-red" onclick="completeZone('exhaust',true)" style="flex:1" ${!S.loto.applied ? 'disabled' : ''}>
        ${!S.loto.applied ? '🔒 Requiere LOTO para intervenir' : '🔧 Apretar abrazadera — Registrar'}
       </button>` :
      `<button class="btn-primary btn-green" onclick="completeZone('exhaust')" style="flex:1">✅ Escape OK — Continuar</button>`
    }
    <button class="btn-primary" onclick="closeModal()" style="flex:0.4;background:var(--bg2);border:1px solid var(--border2);color:var(--dim)">Cancelar</button>
  </div>`;
}

// ─── BATTERY ───
function buildBattery() {
  const hasIssue = ISSUES['battery'];
  const volt = S.battVolt.toFixed(1); // Use S.battVolt directly
  const chargePct = hasIssue ? Math.round(Math.max(0, (parseFloat(volt) - 21.6) / 3.6 * 100)) : 85+Math.round(Math.random()*12);
  const voltOk = parseFloat(volt) >= 24.4;

  return `
  <div class="modal-hdr">
    <div class="modal-icon">🔋</div>
    <div>
      <div class="modal-title" style="color:var(--cyan)">BATERÍA DE ARRANQUE</div>
      <div style="font-size:0.75rem;color:var(--dim);margin-top:3px">24V DC · Arranque y control del controlador DSE</div>
    </div>
  </div>
  <div class="modal-body">
    ${hasIssue ? `
    <div class="anomaly-scene" style="text-align:left">
      <div class="anomaly-emoji" style="float:left; margin-right:12px">⚠️</div>
      <div class="anomaly-title">TERMINAL CORROÍDA + BATERÍA BAJA</div>
      <div class="anomaly-desc">La terminal positiva presenta sulfato (corrosión). <strong>Haz clic repetidamente sobre el terminal para limpiarlo.</strong> El bajo voltaje (${volt}V) también requiere atención.</div>
    </div>
    <div class="batt-clean-wrap">
        <div class="batt-terminal-interactive" id="batt-clean-target">
            <div class="batt-terminal-icon">🔋</div>
            <div class="batt-sulfate" id="batt-sulfate">❄️</div>
        </div>
        <div class="clean-prog-wrap">
            <div class="clean-prog-lbl">PROGRESO DE LIMPIEZA</div>
            <div class="clean-prog-track"><div class="clean-prog-fill" id="batt-clean-bar"></div></div>
        </div>
    </div>
    <div class="fix-steps">
      <div class="fix-step"><div class="fix-step-num">1</div><div class="fix-step-txt">Desconectar terminal negativa primero, luego positiva</div></div>
      <div class="fix-step"><div class="fix-step-num">2</div><div class="fix-step-txt">Limpiar con solución de <strong>bicarbonato + agua</strong> y cepillo de cerdas duras</div></div>
      <div class="fix-step"><div class="fix-step-num">3</div><div class="fix-step-txt">Reconectar positiva primero, luego negativa. Aplicar vaselina en terminales</div></div>
    </div>` : `
    <div class="battery-visual">
      <div style="text-align:center">
        <div class="batt-body">
          <div class="batt-plus"></div>
          <div class="batt-minus"></div>
          <div style="position:absolute;left:0;top:0;bottom:0;background:${voltOk?'linear-gradient(90deg,#00aaff33,#00ccff11)':'linear-gradient(90deg,#ff2d4422,#ff000011)'};transition:width 1s ease;width:0%" id="batt-fill-inner"></div>
          <div class="batt-pct" style="color:${voltOk?'var(--blue)':'var(--red)'}">${chargePct}%</div>
        </div>
        <div style="font-size:0.7rem;color:var(--dim);margin-top:6px;font-family:'Share Tech Mono',monospace">NIVEL DE CARGA</div>
      </div>
      <div class="batt-info">
        <div class="batt-row"><span class="bk">VOLTAJE:</span><span class="bv" style="color:${voltOk?'var(--green)':'var(--red)'}">${volt} V</span></div>
        <div class="batt-row"><span class="bk">ESTADO:</span><span class="bv" style="color:${voltOk?'var(--green)':'var(--red)'}">${voltOk?'CARGADA':'BAJA'}</span></div>
        <div class="batt-row"><span class="bk">TERMINAL +:</span><span class="bv" style="color:var(--green)">LIMPIA</span></div>
        <div class="batt-row"><span class="bk">TERMINAL −:</span><span class="bv" style="color:var(--green)">LIMPIA</span></div>
        <div class="batt-row"><span class="bk">CABLES:</span><span class="bv" style="color:var(--green)">APRETADOS</span></div>
      </div>
    </div>
    <div class="didact-box">
      <div class="db-title">Batería en óptimas condiciones</div>
      Voltaje: ${volt}V (cargada). Terminales limpias y bien apretadas. El controlador DSE mostrará voltaje de carga (~27.8V) cuando el motor esté en marcha. ✅
    </div>`}
  </div>
  <div class="modal-footer">
    ${hasIssue ?
      `<button class="btn-primary btn-amber" id="batt-fix-btn" onclick="completeZone('battery',true)" style="flex:1" disabled>
        🔧 Registrar Limpieza y Carga
       </button>` :
      `<button class="btn-primary btn-green" onclick="completeZone('battery')" style="flex:1">✅ Batería OK — Continuar</button>`
    }
    <button class="btn-primary" onclick="closeModal()" style="flex:0.4;background:var(--bg2);border:1px solid var(--border2);color:var(--dim)">Cancelar</button>
  </div>`;
}

// ─── BELTS ───
function buildBelts() {
  const hasIssue = ISSUES['belts'];
  return `
  <div class="modal-hdr">
    <div class="modal-icon">⚙️</div>
    <div>
      <div class="modal-title" style="color:var(--cyan)">CORREAS Y POLEAS</div>
      <div style="font-size:0.75rem;color:var(--dim);margin-top:3px">Correa serpentina · Polea tensora · Alternador</div>
    </div>
  </div>
  <div class="modal-body">
    <div class="belt-visual">
      <div class="pulley" style="width:70px;height:70px;left:20px;top:15px;border-color:var(--border2)">
        <div class="pulley-inner" style="width:48px;height:48px;margin:11px"></div>
        <span style="position:absolute;bottom:-18px;left:50%;transform:translateX(-50%);font-size:0.58rem;font-family:'Share Tech Mono',monospace;color:var(--dim)">CIGÜEÑAL</span>
      </div>
      <div class="pulley" style="width:44px;height:44px;right:30px;top:8px;border-color:${hasIssue?'var(--amber)':'var(--border2)'}">
        <div class="pulley-inner" style="width:28px;height:28px;margin:8px"></div>
        <span style="position:absolute;bottom:-18px;left:50%;transform:translateX(-50%);font-size:0.58rem;font-family:'Share Tech Mono',monospace;color:var(--dim)">ALT.</span>
      </div>
      <div class="pulley" style="width:30px;height:30px;right:110px;top:60px;border-color:var(--border2)">
        <div class="pulley-inner" style="width:18px;height:18px;margin:6px"></div>
        <span style="position:absolute;bottom:-18px;left:50%;transform:translateX(-50%);font-size:0.58rem;font-family:'Share Tech Mono',monospace;color:var(--dim)">TENSOR</span>
      </div>
      <div class="belt-line ${hasIssue?'cracked':''}" style="height:6px;top:28px;left:90px;width:180px;border-radius:3px;background:${hasIssue?'repeating-linear-gradient(90deg,var(--amber) 0,var(--amber) 8px,#442200 8px,#442200 14px)':'var(--border2)'}"></div>
    </div>
    ${hasIssue ? `
    <div class="anomaly-scene">
      <div class="anomaly-emoji">💢</div>
      <div class="anomaly-title">CORREA CON GRIETAS Y DESGASTE</div>
      <div class="anomaly-desc">La correa del alternador presenta grietas transversales profundas en el interior y la superficie muestra deshilachamiento. Una rotura durante operación detendrá la bomba de agua (sobrecalentamiento en ~3 min) y la carga de batería.</div>
    </div>
    <div class="fix-steps">
      <div class="fix-step"><div class="fix-step-num">1</div><div class="fix-step-txt">Identificar la referencia de la correa (impresa en el exterior)</div></div>
      <div class="fix-step"><div class="fix-step-num">2</div><div class="fix-step-txt">Liberar la polea tensora girando el tensor en sentido contrario a las manecillas</div></div>
      <div class="fix-step"><div class="fix-step-num">3</div><div class="fix-step-txt">Reemplazar la correa y verificar el alineamiento de poleas con regla</div></div>
      <div class="fix-step"><div class="fix-step-num">4</div><div class="fix-step-txt">Verificar tensión: deflexión de <strong>1-1.5 cm</strong> al presionar con el pulgar</div></div>
    </div>` : `
    <div class="didact-box">
      <div class="db-title">Estado de correas y poleas</div>
      Correa sin grietas, tensión correcta (deflexión ~1.2 cm). Poleas alineadas y sin juego radial. Superficie de la correa sin señales de deslizamiento (polvo negro). ✅
    </div>`}
  </div>
  <div class="modal-footer">
    ${hasIssue ?
      `<button class="btn-primary btn-amber" onclick="completeZone('belts',true)" style="flex:1" ${!S.loto.applied ? 'disabled' : ''}>
        ${!S.loto.applied ? '🔒 Requiere LOTO para intervenir' : '🔧 Reemplazar correa'}
       </button>` :
      `<button class="btn-primary btn-green" onclick="completeZone('belts')" style="flex:1">✅ Correas OK — Continuar</button>`
    }
    <button class="btn-primary" onclick="closeModal()" style="flex:0.4;background:var(--bg2);border:1px solid var(--border2);color:var(--dim)">Cancelar</button>
  </div>`;
}

// ─── NUEVO: LEAKS ───
function buildLeaks() {
  const hasIssue = ISSUES['leaks'];
  return `
  <div class="modal-hdr">
    <div class="modal-icon">💧</div>
    <div>
      <div class="modal-title" style="color:var(--cyan)">INSPECCIÓN DE FUGAS</div>
      <div style="font-size:0.75rem;color:var(--dim);margin-top:3px">Revisión visual de aceite, refrigerante y combustible</div>
    </div>
  </div>
  <div class="modal-body">
    <div class="leak-check-grid">
      <div class="leak-item">
        <div class="leak-icon">🛢️</div>
        <div class="leak-title">ACEITE</div>
        <div class="leak-status ok">SIN FUGAS</div>
      </div>
      <div class="leak-item">
        <div class="leak-icon">⛽</div>
        <div class="leak-title">COMBUSTIBLE</div>
        <div class="leak-status ${hasIssue ? 'bad' : 'ok'}">${hasIssue ? '¡FUGA DETECTADA!' : 'SIN FUGAS'}</div>
        ${hasIssue ? '<div class="puddle" style="background:#ffa50044; box-shadow:0 0 10px #ffa500aa"></div>' : ''}
      </div>
      <div class="leak-item">
        <div class="leak-icon">🌡️</div>
        <div class="leak-title">REFRIGERANTE</div>
        <div class="leak-status ok">SIN FUGAS</div>
      </div>
    </div>
    ${hasIssue ? `
    <div class="anomaly-scene" style="margin-top:16px">
      <div class="anomaly-emoji">🔥</div>
      <div class="anomaly-title">FUGA DE COMBUSTIBLE EN LÍNEA DE INYECCIÓN</div>
      <div class="anomaly-desc">Se detectó un goteo activo de diesel en la conexión de la línea de combustible al filtro secundario. Esto representa un <strong>riesgo crítico de incendio</strong> y debe ser corregido inmediatamente.</div>
    </div>
    <div class="fix-steps">
      <div class="fix-step"><div class="fix-step-num">1</div><div class="fix-step-txt">Colocar material absorbente para contener el derrame.</div></div>
      <div class="fix-step"><div class="fix-step-num">2</div><div class="fix-step-txt">Usando dos llaves, apretar la tuerca de la conexión (racor) hasta detener la fuga.</div></div>
      <div class="fix-step"><div class="fix-step-num">3</div><div class="fix-step-txt">Limpiar completamente el área y verificar que la fuga haya cesado.</div></div>
    </div>` : `
    <div class="didact-box" style="margin-top:16px">
      <div class="db-title">Inspección de Fugas Completa</div>
      No se observan charcos, goteos ni manchas de humedad de aceite, combustible o refrigerante debajo del motor o en sus conexiones. ✅
    </div>`}
  </div>
  <div class="modal-footer">
    ${hasIssue ?
      `<button class="btn-primary btn-red" onclick="completeZone('leaks',true)" style="flex:1" ${!S.loto.applied ? 'disabled' : ''}>
        ${!S.loto.applied ? '🔒 Requiere LOTO para intervenir' : '🔧 Apretar conexión y limpiar'}
       </button>` :
      `<button class="btn-primary btn-green" onclick="completeZone('leaks')" style="flex:1">✅ Sin Fugas — Continuar</button>`
    }
    <button class="btn-primary" onclick="closeModal()" style="flex:0.4;background:var(--bg2);border:1px solid var(--border2);color:var(--dim)">Cancelar</button>
  </div>`;
}

// ─── NUEVO: ENVIRONMENT ───
function buildEnvironment() {
    const hasIssue = ISSUES['environment'];
    if (hasIssue) {
        const ragX = 20 + Math.random() * 60; // %
        const ragY = 30 + Math.random() * 50; // %
        return `
        <div class="modal-hdr"><div class="modal-icon">🧹</div><div><div class="modal-title" style="color:var(--cyan)">ENTORNO DEL EQUIPO</div><div style="font-size:0.75rem;color:var(--dim);margin-top:3px">Cuarto de máquinas y área circundante</div></div></div>
        <div class="modal-body">
            <div class="anomaly-scene" style="padding:14px; text-align:left;">
                <div class="anomaly-emoji" style="float:left; margin-right:12px;">⚠️</div>
                <div class="anomaly-title" style="color:var(--amber)">OBJETO EXTRAÑO EN EL ÁREA</div>
                <div class="anomaly-desc">Se encontró un trapo sucio cerca de la admisión de aire del motor. Los objetos sueltos pueden ser succionados o causar un riesgo de incendio.</div>
            </div>
            <div class="env-scene" id="env-scene">
                <div class="env-scene-title">ARRASTRA EL TRAPO AL BOTE DE BASURA</div>
                <div class="env-rag" id="env-rag" draggable="true" style="left:${ragX}%; top:${ragY}%;">🧣</div>
                <div class="env-trash" id="env-trash">🗑️</div>
            </div>
            <div class="fix-steps">
                <div class="fix-step"><div class="fix-step-num">1</div><div class="fix-step-txt">Identifica y retira cualquier objeto suelto o material inflamable del área.</div></div>
                <div class="fix-step"><div class="fix-step-num">2</div><div class="fix-step-txt">Asegura que las entradas y salidas de aire estén completamente despejadas.</div></div>
            </div>
        </div>
        <div class="modal-footer">
            <button class="btn-primary btn-amber" id="env-fix-btn" onclick="completeZone('environment',true)" style="flex:1" disabled>🧹 Área Despejada — Registrar</button>
            <button class="btn-primary" onclick="closeModal()" style="flex:0.4;background:var(--bg2);border:1px solid var(--border2);color:var(--dim)">Cancelar</button>
        </div>`;
    } else {
        return `
        <div class="modal-hdr"><div class="modal-icon">🧹</div><div><div class="modal-title" style="color:var(--cyan)">ENTORNO DEL EQUIPO</div><div style="font-size:0.75rem;color:var(--dim);margin-top:3px">Cuarto de máquinas y área circundante</div></div></div>
        <div class="modal-body">
            <div class="anomaly-scene" style="padding:24px"><div class="anomaly-emoji" style="font-size:4rem">✨</div><div class="anomaly-title" style="color:var(--green)">ÁREA DESPEJADA Y SEGURA</div><div class="anomaly-desc">El área alrededor del generador está limpia, seca y libre de obstrucciones. Las rutas de acceso y ventilación están despejadas.</div></div>
        </div>
        <div class="modal-footer">
            <button class="btn-primary btn-green" onclick="completeZone('environment')" style="flex:1">✅ Entorno OK — Continuar</button>
            <button class="btn-primary" onclick="closeModal()" style="flex:0.4;background:var(--bg2);border:1px solid var(--border2);color:var(--dim)">Cancelar</button>
        </div>`;
    }
}

// ─── NUEVO: BREAKERS ───
function buildBreakers() {
    const hasIssue = ISSUES['breakers'];
    return `
    <div class="modal-hdr">
        <div class="modal-icon">⚡</div>
        <div>
            <div class="modal-title" style="color:var(--cyan)">BREAKERS DE PROTECCIÓN</div>
            <div style="font-size:0.75rem;color:var(--dim);margin-top:3px">Interruptores principal y de control</div>
        </div>
    </div>
    <div class="modal-body">
        <div class="breaker-panel">
            <div class="breaker-row">
                <div>
                    <div class="breaker-label">BREAKER PRINCIPAL (400A)</div>
                    <div style="font-size:0.7rem;color:var(--dim)">Protección del Alternador</div>
                </div>
                <div class="breaker-switch ${hasIssue ? 'off' : 'on'}" onclick="this.classList.toggle('on'); this.classList.toggle('off');">
                    <div class="breaker-lever"></div>
                </div>
            </div>
            <div class="breaker-row">
                <div>
                    <div class="breaker-label">BREAKER DE CONTROL (10A)</div>
                    <div style="font-size:0.7rem;color:var(--dim)">Alimentación del Panel DSE</div>
                </div>
                <div class="breaker-switch on"><div class="breaker-lever"></div></div>
            </div>
        </div>
        ${hasIssue ? `
        <div class="anomaly-scene" style="margin-top:16px">
            <div class="anomaly-emoji">🔌</div>
            <div class="anomaly-title">BREAKER PRINCIPAL DISPARADO (OFF)</div>
            <div class="anomaly-desc">El interruptor principal del generador está en posición 'OFF'. El motor arrancará, pero <strong>no podrá entregar energía</strong> a la carga. Debe ser rearmado antes de la operación.</div>
        </div>` : `
        <div class="didact-box" style="margin-top:16px">
            <div class="db-title">Estado de los Breakers</div>
            Ambos interruptores, principal y de control, se encuentran en la posición 'ON' (cerrado). El equipo está listo para transferir carga. ✅
        </div>`}
    </div>
    <div class="modal-footer">
    ${hasIssue ?
      `<button class="btn-primary btn-amber" onclick="completeZone('breakers',true)" style="flex:1">⚡ Rearmar Breaker Principal</button>` :
      `<button class="btn-primary btn-green" onclick="completeZone('breakers')" style="flex:1">✅ Breakers OK — Continuar</button>`
    }
    <button class="btn-primary" onclick="closeModal()" style="flex:0.4;background:var(--bg2);border:1px solid var(--border2);color:var(--dim)">Cancelar</button>
  </div>`;
}

// ─── NUEVO: LOTO ───
function buildLoto() {
    const motorOff = !S.engine && !S.starting && !S.stopping;
    const estopOn = S.estop;
    const notified = S.loto.notified;
    const allIdentified = Object.values(S.loto.energies).every(v => v);

    // --- VISTA DE DESBLOQUEO (Si LOTO ya está aplicado) ---
    if (S.loto.applied) {
        const unlockNotified = S.loto.unlockNotified;
        return `
        <div class="modal-hdr"><div class="modal-icon">🔒</div><div><div class="modal-title" style="color:var(--cyan)">RETIRAR BLOQUEO (LOTO)</div></div></div>
        <div class="modal-body">
            <div class="didact-box warn"><div class="db-title">Paso 1: Notificar</div>Vaya al panel de <strong>Radio de Comunicaciones</strong> y use el pulsador (PTT) para notificar a todo el personal que el equipo será re-energizado.</div>
            <div class="loto-prereq">
                <div class="loto-prereq-item"><span>- Personal notificado para desbloqueo</span> <span>${unlockNotified ? '✅' : '❌'}</span></div>
            </div>
            <div class="loto-tag-preview">
                <strong>⚠️ EQUIPO BLOQUEADO ⚠️</strong>
                <div><strong>PELIGRO:</strong> No operar.</div>
                <div>Esta etiqueta solo puede ser retirada por:</div>
                <div class="loto-name">${S.loto.taggedBy || 'Operador Autorizado'}</div>
            </div>
            <div class="fix-steps" style="margin-top:16px">
              <div class="fix-step"><div class="fix-step-num">1</div><div class="fix-step-txt">Verificar que la intervención ha finalizado y el equipo está en condiciones seguras.</div></div>
              <div class="fix-step"><div class="fix-step-num">2</div><div class="fix-step-txt"><strong>Notificar al personal por radio</strong> sobre la re-energización.</div></div>
              <div class="fix-step"><div class="fix-step-num">3</div><div class="fix-step-txt">Retirar candado y etiqueta de seguridad.</div></div>
              <div class="fix-step"><div class="fix-step-num">4</div><div class="fix-step-txt">Reconectar la batería para energizar el panel de control.</div></div>
            </div>
        </div>
        <div class="modal-footer">
            <button class="btn-primary btn-green" onclick="toggleLotoState(false)" style="flex:1" ${!unlockNotified ? 'disabled title="Requiere notificación por radio"' : ''}>🔓 Retirar Bloqueo y Reconectar</button>
            <button class="btn-primary" onclick="closeModal()" style="flex:0.4;background:var(--bg2);border:1px solid var(--border2);color:var(--dim)">Cancelar</button>
        </div>`;
    }

    // --- VISTAS DEL PROCESO DE BLOQUEO (POR ETAPAS) ---

    // ETAPA 1: IDENTIFICACIÓN DE ENERGÍA
    if (S.loto.stage === 'identify') {
        // NUEVO: Barajar las zonas de destino para que no sean predecibles.
        const energyTypes = [
            { type: 'mechanical', label: 'Energía Mecánica' },
            { type: 'chemical',   label: 'Energía Química' },
            { type: 'dc',         label: 'Energía Eléctrica (DC)' },
            { type: 'ac',         label: 'Energía Eléctrica (AC)' },
            { type: 'thermal',    label: 'Energía Térmica' }
        ];
        // Algoritmo de Fisher-Yates para barajar
        for (let i = energyTypes.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [energyTypes[i], energyTypes[j]] = [energyTypes[j], energyTypes[i]];
        }

        const dropZonesHtml = energyTypes.map(et => `<div class="loto-drop-zone ${S.loto.energies[et.type] ? 'correct' : ''}" data-type="${et.type}"><span class="loto-drop-label">${S.loto.energies[et.type] ? `✅ ${et.label.toUpperCase()}` : et.label}</span></div>`).join('');

        return `
        <div class="modal-hdr"><div class="modal-icon">🔒</div><div><div class="modal-title" style="color:var(--cyan)">LOTO - PASO 1: IDENTIFICACIÓN</div></div></div>
        <div class="modal-body">
            <div class="didact-box"><div class="db-title">Identificar Fuentes de Energía</div>Arrastra cada fuente (izquierda) a su tipo de energía correspondiente (derecha) para confirmar que reconoces todos los peligros.</div>
            <div class="loto-energy-grid">
                <div class="loto-drag-items">
                    <div class="loto-energy-col-title">Fuentes de Energía</div>
                    <div class="loto-drag-item ${S.loto.energies.mechanical ? 'dropped' : ''}" draggable="true" data-type="mechanical"><span class="loto-drag-icon">⚙️</span><span class="loto-drag-label">Motor</span></div>
                    <div class="loto-drag-item ${S.loto.energies.chemical ? 'dropped' : ''}" draggable="true" data-type="chemical"><span class="loto-drag-icon">⛽</span><span class="loto-drag-label">Combustible</span></div>
                    <div class="loto-drag-item ${S.loto.energies.dc ? 'dropped' : ''}" draggable="true" data-type="dc"><span class="loto-drag-icon">🔋</span><span class="loto-drag-label">Batería</span></div>
                    <div class="loto-drag-item ${S.loto.energies.ac ? 'dropped' : ''}" draggable="true" data-type="ac"><span class="loto-drag-icon">⚡</span><span class="loto-drag-label">Alternador</span></div>
                    <div class="loto-drag-item ${S.loto.energies.thermal ? 'dropped' : ''}" draggable="true" data-type="thermal"><span class="loto-drag-icon">🔥</span><span class="loto-drag-label">Escape / Radiador</span></div>
                </div>
                <div class="loto-drop-zones">
                    <div class="loto-energy-col-title">Tipos de Energía Peligrosa</div>
                    ${dropZonesHtml}
                </div>
            </div>
        </div>
        <div class="modal-footer">
            <button class="btn-primary btn-blue" onclick="setLotoStage('notify')" ${!allIdentified ? 'disabled' : ''}>Continuar a Notificación →</button>
            <button class="btn-primary" onclick="cancelLotoProcedure()" style="flex:0.4;background:var(--bg2);border:1px solid var(--border2);color:var(--dim)">Cancelar</button>
        </div>`;
    }

    // ETAPA 2: NOTIFICAR AL PERSONAL
    if (S.loto.stage === 'notify') {
        return `
        <div class="modal-hdr"><div class="modal-icon">🔒</div><div><div class="modal-title" style="color:var(--cyan)">LOTO - PASO 2: NOTIFICAR AL PERSONAL</div></div></div>
        <div class="modal-body">
            <div class="didact-box warn"><div class="db-title">Acción Requerida</div>Vaya al panel de <strong>Radio de Comunicaciones</strong> y use el pulsador (PTT) para notificar a todo el personal sobre el procedimiento de bloqueo.</div>
            <div class="loto-prereq">
                <div class="loto-prereq-item"><span>- Personal notificado por radio</span> <span>${notified ? '✅' : '❌'}</span></div>
            </div>
            ${notified ? `<div class="didact-box ok" style="border-left-color:var(--green);"><div class="db-title" style="color:var(--green)">Notificación Completa</div>Puede continuar con el apagado del equipo.</div>` : ''}
        </div>
        <div class="modal-footer">
            <button class="btn-primary btn-blue" onclick="setLotoStage('shutdown')" ${!notified ? 'disabled' : ''}>Continuar a Apagado →</button>
            <button class="btn-primary" onclick="cancelLotoProcedure()" style="flex:0.4;background:var(--bg2);border:1px solid var(--border2);color:var(--dim)">Cancelar</button>
        </div>`;
    }

    // ETAPA 3: APAGADO Y NEUTRALIZACIÓN
    if (S.loto.stage === 'shutdown') {
        return `
        <div class="modal-hdr"><div class="modal-icon">🔒</div><div><div class="modal-title" style="color:var(--cyan)">LOTO - PASO 3: APAGADO Y NEUTRALIZACIÓN</div></div></div>
        <div class="modal-body">
            <div class="didact-box warn"><div class="db-title">Acción Requerida</div>Vaya al <strong>Panel Controlador</strong> y realice las siguientes acciones en orden:
                <ul class="db-list" style="margin-top:6px">
                    <li>Colocar el selector de modo en <strong>PARAR</strong>.</li>
                    <li>Activar el <strong>Paro de Emergencia</strong> (botón rojo).</li>
                </ul>
            </div>
            <div class="loto-prereq">
                <div class="loto-prereq-item"><span>- Selector en modo PARAR (OFF)</span> <span>${motorOff ? '✅' : '❌'}</span></div>
                <div class="loto-prereq-item"><span>- Paro de Emergencia (E-Stop) activado</span> <span>${estopOn ? '✅' : '❌'}</span></div>
            </div>
        </div>
        <div class="modal-footer">
            <button class="btn-primary btn-blue" onclick="setLotoStage('isolate')" ${!(motorOff && estopOn) ? 'disabled' : ''}>Continuar a Bloqueo →</button>
            <button class="btn-primary" onclick="cancelLotoProcedure()" style="flex:0.4;background:var(--bg2);border:1px solid var(--border2);color:var(--dim)">Cancelar</button>
        </div>`;
    }

    // ETAPA 4: BLOQUEO Y ETIQUETADO
    if (S.loto.stage === 'isolate') {
        const tagArea = S.loto.batteryDisconnected ? `
        <div class="loto-tag-area" id="loto-tag-area">
            <div style="font-weight: 700; margin-bottom: 12px; color: var(--amber);">PASO 4.2: Etiquetado</div>
            <input type="text" id="loto-name-input" class="loto-tag-input" placeholder="Ingrese su nombre para la etiqueta...">
            <button class="btn-primary btn-amber" id="loto-confirm-btn" onclick="confirmLotoTag()" disabled>Colocar Etiqueta y Continuar</button>
        </div>` : '';

        return `
        <div class="modal-hdr"><div class="modal-icon">🔒</div><div><div class="modal-title" style="color:var(--cyan)">LOTO - PASO 4: BLOQUEO Y ETIQUETADO</div></div></div>
        <div class="modal-body">
            <div class="didact-box"><div class="db-title">PASO 4.1: Aislamiento de Energía</div>Desconecte la batería para desenergizar completamente el panel de control y el sistema de arranque (Control de Energía Almacenada).</div>
            <button class="loto-step-btn ${S.loto.batteryDisconnected ? 'done' : ''}" id="loto-disconnect-btn" onclick="toggleBatteryConnect()" ${S.loto.batteryDisconnected ? 'disabled' : ''}>
                ${S.loto.batteryDisconnected ? '✅ BATERÍA DESCONECTADA' : 'DESCONECTAR BATERÍA'}
            </button>
            ${tagArea}
        </div>
        <div class="modal-footer">
            <button class="btn-primary" onclick="cancelLotoProcedure()" style="flex:0.4;background:var(--bg2);border:1px solid var(--border2);color:var(--dim)">Cancelar</button>
        </div>`;
    }

    // ETAPA 5: VERIFICACIÓN DE ENERGÍA CERO
    if (S.loto.stage === 'verify') {
        return `
        <div class="modal-hdr"><div class="modal-icon">🔒</div><div><div class="modal-title" style="color:var(--cyan)">LOTO - PASO 5: VERIFICACIÓN DE ENERGÍA CERO</div></div></div>
        <div class="modal-body">
            <div class="didact-box warn"><div class="db-title">Acción Requerida</div>Para confirmar que el equipo está en un estado de energía cero, <strong>vaya al panel de control e intente arrancar el motor</strong> con el botón de arranque manual.</div>
            <div class="loto-prereq" style="text-align:center;">
                <div style="font-weight: 700; margin-bottom: 8px;">ESTADO DE VERIFICACIÓN</div>
                <div id="loto-verify-status" style="font-family:'Share Tech Mono', monospace; font-size: 1.2rem; color: var(--amber);">
                    ${S.loto.verificationAttempted ? '✅ VERIFICACIÓN EXITOSA' : 'PENDIENTE DE VERIFICACIÓN...'}
                </div>
            </div>
            ${S.loto.verificationAttempted ? `<div class="didact-box ok" style="border-left-color:var(--green);"><div class="db-title" style="color:var(--green)">Equipo Seguro</div>El intento de arranque falló como se esperaba. El equipo está bloqueado y seguro para intervención.</div>` : ''}
        </div>
        <div class="modal-footer">
            <button class="btn-primary btn-green" id="loto-complete-btn" onclick="completeZone('loto', true)" style="flex:1" ${!S.loto.verificationAttempted ? 'disabled' : ''}>Completar Procedimiento LOTO</button>
            <button class="btn-primary" onclick="cancelLotoProcedure()" style="flex:0.4;background:var(--bg2);border:1px solid var(--border2);color:var(--dim)">Cancelar</button>
        </div>`;
    }
}

function setLotoStage(stage) {
    S.loto.stage = stage;
    openModal('loto');
}

function toggleBatteryConnect() {
    S.loto.batteryDisconnected = !S.loto.batteryDisconnected;
    const panelOverlay = document.getElementById('panel-deenergized');
    if (S.loto.batteryDisconnected) {
        panelOverlay.style.display = 'flex';
        elog('LOTO: Batería desconectada. Panel de control desenergizado.', 'warn');
    } else {
        panelOverlay.style.display = 'none';
        elog('LOTO: Batería reconectada. Panel de control energizado.', 'info');
    }
    // Re-render modal
    openModal('loto');
}

function confirmLotoTag() {
    const input = document.getElementById('loto-name-input');
    if (!input || !input.value.trim()) {
        elog('LOTO: Debe ingresar un nombre para la etiqueta.', 'err');
        return;
    }
    S.loto.taggedBy = input.value.trim();
    elog(`LOTO: Etiqueta colocada por ${S.loto.taggedBy}.`, 'warn');
    // Avanzar a la etapa de verificación
    setLotoStage('verify');
}

function toggleLotoState(apply) {
    S.loto.applied = apply;
    if (!apply) {
        // Reset LOTO state on removal
        S.loto.batteryDisconnected = false;
        S.loto.taggedBy = '';
        S.loto.notified = false;
        S.loto.unlockNotified = false;
        S.loto.stage = 'identify';
        S.loto.verificationAttempted = false;
        Object.keys(S.loto.energies).forEach(k => S.loto.energies[k] = false);

        // Reset radio UI
        const pttBtn = document.getElementById('radio-ptt-btn');
        const radioDesc = document.getElementById('radio-status-desc');
        pttBtn.classList.remove('done');
        pttBtn.querySelector('span').textContent = 'PULSADOR (PTT)';
        radioDesc.textContent = 'Notifique al personal antes de iniciar procedimientos de bloqueo.';
        radioDesc.style.color = 'var(--dim)';

        // Corregido: re-energizar manualmente para evitar invertir la variable por error
        document.getElementById('panel-deenergized').style.display = 'none';
        elog('LOTO: Batería reconectada. Panel de control energizado.', 'info');
        completeZone('loto', false);
    }
}

// ── Post-render animations ──
function afterModalOpen(key) {
  setTimeout(() => {
    // Oil dipstick
    if (key==='oil') {
      document.getElementById('dp-fill').style.height = Math.min(100,S.oilLevel)+'%';
    }
    // Coolant
    if (key==='coolant') {
      const lvl = ISSUES['coolant'] ? Math.min(S.coolantLevel,28) : Math.max(S.coolantLevel,62);
      document.getElementById('ct-fill').style.height = lvl+'%';
    }
    // Fuel
    if (key==='fuel') {
      document.getElementById('ff-fill').style.width = S.fuel+'%';
      document.getElementById('ff-needle').style.left = S.fuel+'%';
    }
    // Battery
    if (key==='battery') {
      const bf = document.getElementById('batt-fill-inner');
      if (bf) {
        const hasIssue = ISSUES['battery'];
            const v = parseFloat(hasIssue ? S.battVolt : (25.2+Math.random()*0.3).toFixed(1));
            bf.style.width = Math.round(Math.max(0, (v - 21.6) / 3.6 * 100))+'%'; // Update based on S.battVolt
      }
    }
    // NUEVO: Interacción de arrastrar y soltar para el entorno
    if (key === 'environment' && ISSUES['environment']) {
        const rag = document.getElementById('env-rag');
        const trash = document.getElementById('env-trash');
        const fixBtn = document.getElementById('env-fix-btn');
        rag.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', 'rag');
            setTimeout(() => { rag.style.visibility = 'hidden'; }, 0);
        });
        rag.addEventListener('dragend', () => {
            rag.style.visibility = 'visible';
        });
        trash.addEventListener('dragover', (e) => {
            e.preventDefault(); // Permitir soltar
            trash.classList.add('over');
        });
        trash.addEventListener('dragleave', () => {
            trash.classList.remove('over');
        });
        trash.addEventListener('drop', (e) => {
            e.preventDefault();
            trash.classList.remove('over');
            if (e.dataTransfer.getData('text/plain') === 'rag') {
                rag.style.display = 'none';
                trash.textContent = '👍';
                fixBtn.disabled = false;
                document.querySelector('.env-scene-title').textContent = '¡ÁREA DESPEJADA!';
                document.querySelector('.env-scene-title').style.color = 'var(--green)';
            }
        });
    }
    // NUEVO: Interacción de limpieza de batería
    if (key === 'battery' && ISSUES['battery']) {
        const target = document.getElementById('batt-clean-target');
        const sulfate = document.getElementById('batt-sulfate');
        const bar = document.getElementById('batt-clean-bar');
        const fixBtn = document.getElementById('batt-fix-btn');
        let clicks = 0;
        const clicksNeeded = 15;

        target.addEventListener('click', () => {
            if (clicks >= clicksNeeded) return;
            
            clicks++;
            const progress = clicks / clicksNeeded;
            
            bar.style.width = `${progress * 100}%`;
            sulfate.style.opacity = 1 - progress;

            if (clicks >= clicksNeeded) {
                sulfate.style.display = 'none';
                const desc = document.querySelector('.anomaly-desc');
                S.battVolt = (24.8 + Math.random() * 0.8); // Restore battery voltage
                if(desc) {
                  desc.textContent = '¡Terminal limpio! La resistencia ha vuelto a la normalidad. Buen trabajo.';
                  desc.style.color = 'var(--green)';
                }
                fixBtn.disabled = false;
            }
        });
    }
    // NUEVO: Interacción de limpieza de radiador
    if (key === 'radiator' && ISSUES['radiator']) {
        const debris = document.getElementById('rad-debris');
        const bar = document.getElementById('rad-clean-bar');
        const fixBtn = document.getElementById('rad-fix-btn');
        let passes = 0;
        const passesNeeded = 25; // Needs more passes than clicks

        debris.addEventListener('mouseover', () => {
            if (passes >= passesNeeded) return;
            
            passes++;
            const progress = passes / passesNeeded;
            
            bar.style.width = `${progress * 100}%`;
            debris.style.opacity = 1 - (progress * 0.9); // Don't make it fully invisible until it's done

            if (passes >= passesNeeded) {
                debris.style.display = 'none';
                const desc = document.querySelector('.anomaly-desc');
                if(desc) {
                  desc.innerHTML = '<strong>¡Obstrucción retirada!</strong> El flujo de aire ha sido restaurado.';
                  desc.style.color = 'var(--green)';
                  S.radiatorBlocked = false; // Fix the issue in state
                }
                fixBtn.disabled = false;
            }
        });
    }
    // NUEVO: Lógica para el modal LOTO en sus diferentes etapas
    if (key === 'loto' && !S.loto.applied) {
        if (S.loto.stage === 'identify') {
            setupLotoDragDrop();
        } else if (S.loto.stage === 'isolate' && S.loto.batteryDisconnected) {
            const nameInput = document.getElementById('loto-name-input');
            const confirmBtn = document.getElementById('loto-confirm-btn');
            if (nameInput && confirmBtn) {
                nameInput.oninput = () => { confirmBtn.disabled = nameInput.value.trim().length < 3; };
            }
        }
    }
  }, 100);
}

// NUEVO: Lógica de Arrastrar y Soltar para LOTO
function setupLotoDragDrop() {
    const draggables = document.querySelectorAll('.loto-drag-item:not(.dropped)');
    const dropzones = document.querySelectorAll('.loto-drop-zone:not(.correct)');
    let draggedItem = null;

    draggables.forEach(item => {
        item.addEventListener('dragstart', () => {
            draggedItem = item;
            setTimeout(() => item.style.opacity = '0.5', 0);
        });
        item.addEventListener('dragend', () => {
            draggedItem = null;
            item.style.opacity = '1';
        });
    });

    dropzones.forEach(zone => {
        zone.addEventListener('dragover', e => {
            e.preventDefault();
            zone.classList.add('over');
        });
        zone.addEventListener('dragleave', () => zone.classList.remove('over'));
        zone.addEventListener('drop', e => {
            e.preventDefault();
            zone.classList.remove('over');
            if (draggedItem && draggedItem.dataset.type === zone.dataset.type) {
                S.loto.energies[zone.dataset.type] = true;
                elog(`LOTO: Energía ${zone.dataset.type.toUpperCase()} identificada.`, 'sys');
                openModal('loto'); // Re-render the modal to show the updated state
            } else {
                elog('LOTO: Identificación incorrecta. Intente de nuevo.', 'err');
            }
        });
    });
}

// ══════════════════════════════════════════════
//  ZONE COMPLETION
// ══════════════════════════════════════════════
function completeZone(key, hasIssue) {
  if (key === 'loto') {
    const floatingBtn = document.getElementById('btn-loto-floating');
    const floatingLbl = document.getElementById('lbl-loto-floating');

    // Special handling for LOTO completion/cancellation
    if (hasIssue) { // This means LOTO was applied
        S.loto.applied = true;
        DONE[key] = 'issue'; // 'issue' state for LOTO means it's active

        // Reset radio for unlock notification
        const pttBtn = document.getElementById('radio-ptt-btn');
        const radioDesc = document.getElementById('radio-status-desc');
        pttBtn.classList.remove('done');
        pttBtn.querySelector('span').textContent = 'PULSADOR (PTT)';
        radioDesc.textContent = 'Equipo bloqueado. Notifique al personal para iniciar el desbloqueo.';
        radioDesc.style.color = 'var(--dim)';

        if (floatingBtn) {
            floatingBtn.classList.add('active');
            floatingLbl.textContent = 'EQUIPO BLOQUEADO';
        }
    } else { // This means LOTO was removed
        delete DONE[key];
        if (floatingBtn) {
            floatingBtn.classList.remove('active');
            floatingLbl.textContent = 'INICIAR LOTO';
        }
    }
  } else {
    DONE[key] = hasIssue ? 'issue' : 'ok';
    if (hasIssue) {
      S.issuesFound++;
    }
  }
  
  closeModal();

  // La retroalimentación visual ahora se maneja en el checklist de la derecha.

  // Update step card
  const card = document.getElementById('sc-'+key);
  if (card) {
    card.classList.remove('active-step', 'expanded', 'done-step', 'fixed-step');
    if (DONE[key]) {
        card.classList.add(DONE[key] === 'issue' ? 'fixed-step' : 'done-step');
    }
  }
  const sn = document.getElementById('sn-'+key);
  if (sn) {
    if (DONE[key]) {
        sn.className = 'step-num ' + (DONE[key] === 'issue' ? 'fixed' : 'done');
        sn.textContent = '✓';
    } else {
        sn.className = 'step-num';
        sn.textContent = STEPS.findIndex(step => step.key === key) + 1;
    }
  }

  const ss = document.getElementById('ss-'+key);
  if (ss) {
    if (DONE[key]) {
        ss.textContent = DONE[key] === 'issue' ? '⚠️ Procedimiento LOTO Activo' : '✅ Verificado — Sin anomalías';
        if (key !== 'loto') {
            ss.textContent = hasIssue ? '⚠️ Anomalía detectada y corregida' : '✅ Verificado — Sin anomalías';
        }
    } else {
        ss.textContent = STEPS.find(step => step.key === key)?.sub || '';
    }
  }

  const btn = document.getElementById('ibtn-'+key);
  if (btn) {
    if (DONE[key]) {
        btn.textContent = DONE[key] === 'issue' ? '🔓 RETIRAR BLOQUEO' : '✅ Inspección completada';
        if (key !== 'loto') {
            btn.textContent = hasIssue ? '⚠️ Anomalía registrada y corregida' : '✅ Inspección completada';
        }
        btn.disabled = key !== 'loto'; // Can always open LOTO modal to unlock
        btn.className = 'inspect-btn ' + (DONE[key] === 'issue' ? 'btn-red' : 'done-btn');
    } else {
        const label = STEPS.find(step => step.key === key)?.label || '';
        btn.textContent = `🔍 Inspeccionar ${label}`;
        btn.disabled = false;
        btn.className = 'inspect-btn';
    }
  }

  // Update internal state based on fixed issues
  if (key === 'oil' && DONE['oil'] === 'ok') S.oilLevel = 70 + Math.random() * 20; // Assume oil added
  if (key === 'coolant' && DONE['coolant'] === 'ok') S.coolantLevel = 70 + Math.random() * 20; // Assume coolant added
  if (key === 'battery' && DONE['battery'] === 'ok') S.battVolt = (24.8 + Math.random() * 0.8); // Assume battery charged
  if (key === 'radiator' && DONE['radiator'] === 'ok') S.radiatorBlocked = false;
  if (key === 'airfilter' && DONE['airfilter'] === 'ok') S.airFilterBlocked = false;
  if (key === 'belts' && DONE['belts'] === 'ok') S.beltBroken = false;
  if (key === 'leaks' && DONE['leaks'] === 'ok') S.fuelLeakRate = 0;
  if (key === 'environment' && DONE['environment'] === 'ok') {
    // No specific state variable to change for environment, just marks as done
  }
  if (key === 'breakers' && DONE['breakers'] === 'ok') {
    // Breakers are interactive in modal, assume user fixed it there
  }


  updateProgress();
}

function updateProgress() {
  const total = STEPS.length;
  const done = Object.keys(DONE).length;
  const pct = Math.round(done/total*100);

  document.getElementById('sc-done').textContent = done;
  document.getElementById('sc-issues').textContent = S.issuesFound;
  document.getElementById('sc-pct').textContent = pct+'%';
  document.getElementById('sc-bar').style.width = pct+'%';

  // Header chip
  document.getElementById('chip-cl').textContent = `CHECKLIST: ${done}/${total}`;
  document.getElementById('chip-cl').className = done===total ? 'stat-chip chip-ok' : 'stat-chip chip-warn';

  if (done === total) {
    S.checkDone = true;
    clearInterval(S.timerInt);
    document.getElementById('gc-status').textContent = '✅ Todos los sistemas verificados';
    document.getElementById('gc-status').style.color = 'var(--green)';

    const elapsed = Math.floor((Date.now() - S.timerStart)/1000);
    const m = String(Math.floor(elapsed/60)).padStart(2,'0');
    const s = String(elapsed%60).padStart(2,'0');

    const sub = `Tiempo de inspección: ${m}:${s} · ${S.issuesFound} anomalía(s) detectada(s) y corregida(s). El equipo está listo para ser arrancado.`;
    document.getElementById('complete-sub').textContent = sub;
    document.getElementById('complete-card').classList.add('show');
    document.getElementById('panel-badge').classList.add('show');

    document.querySelectorAll('.step-card.expanded').forEach(c=>c.classList.remove('expanded'));
  } else {
    // Auto-expand next undone, ONLY in guided mode.
    if (!S.examMode) {
      const nextKey = STEPS.find(s=>!DONE[s.key]);
      if (nextKey) {
        setTimeout(() => {
          document.querySelectorAll('.step-card.active-step').forEach(c => c.classList.remove('active-step'));
          const card = document.getElementById('sc-'+nextKey.key);
          if (card) {
            card.classList.add('expanded','active-step');
            card.scrollIntoView({behavior:'smooth',block:'nearest'});
          }
        }, 300);
      }
    }
  }
}

// ══════════════════════════════════════════════
//  TABS
// ══════════════════════════════════════════════
function goTab(id) {
  document.querySelectorAll('.tab').forEach((t,i) => {
    t.classList.toggle('active', (i===0&&id==='cl')||(i===1&&id==='panel'));
  });
  document.querySelectorAll('.sec').forEach(s=>s.classList.remove('active'));
  document.getElementById('sec-'+id).classList.add('active');
  if (id==='panel') {
    document.getElementById('panel-badge').classList.remove('show');
    if (!S.checkDone) document.getElementById('cl-warn').classList.add('show');
    else document.getElementById('cl-warn').classList.remove('show');
    updateLamps();
  }
  if (id === 'panel' && S.loto.stage === 'verify' && !S.loto.verificationAttempted) {
      S.loto.verificationAttempted = true;
      elog('LOTO: Verificación de energía cero confirmada al observar el panel inoperable.', 'ok');
      // No es necesario reabrir el modal, el estado se actualiza.
      // El usuario lo verá cuando regrese al checklist y abra el modal de LOTO.
      closeModal(); // Cerramos el modal de LOTO si estaba abierto.
  }
}

// ══════════════════════════════════════════════
//  PANEL Y DINAMICA
// ══════════════════════════════════════════════


function navigateDisplay(dir) {
  if (S.estop) return; // No permitir navegación con E-Stop activo
  const len = S.displayPages.length;
  S.displayPage = (S.displayPage + dir + len) % len;
  updateDisplayPage();
}

function updateDisplayPage() {
  const pageKey = S.displayPages[S.displayPage];
  
  document.querySelectorAll('.disp-page').forEach(p => p.classList.remove('active'));
  const pageEl = document.getElementById(`disp-page-${pageKey}`);
  if (pageEl) pageEl.classList.add('active');

  const pageTitles = { gen: 'VALORES DEL GENERADOR', engine: 'VALORES DEL MOTOR', grid: 'VALORES DE RED' };
  document.getElementById('disp-page-name').textContent = pageTitles[pageKey];

  if (pageKey === 'grid') {
    updateGridPageDisplay();
  }
}

function updateGridPageDisplay() {
    const g = S.grid;
    document.getElementById('d-grid-v').textContent = g ? '277' : '0';
    document.getElementById('d-grid-f').textContent = g ? '60.0' : '0.0';
    const stEl = document.getElementById('d-grid-st');
    stEl.textContent = g ? 'PRESENTE' : 'AUSENTE';
    stEl.className = 'd-val ' + (g ? 'g' : 'r');
}

// Lógica de E-STOP
function toggleEStop() {
  const btn = document.getElementById('btn-estop');

  S.estop = !S.estop;

  if (S.estop) {
    btn.classList.add('pressed');
    S.fault = true;
    elog('🚨 PARO DE EMERGENCIA ACTIVADO 🚨', 'err');
    setAlarm('EMERGENCIA — E-STOP PRESIONADO', 'fault');

    // Corte inmediato, sin enfriamiento
    if (S.engine || S.starting) {
      S.engine = false; S.starting = false; S.stopping = false;
      stopValues();
      startCooldown(); // Permitir que el motor se enfríe de forma natural
      clearDisps();
      document.getElementById('run-strip').classList.remove('on');
      document.getElementById('chip-eng').textContent='MOTOR: BLOQUEADO';
      document.getElementById('chip-eng').className='stat-chip chip-err';
      clearTimeout(S.autoStartT); clearTimeout(S.autoStopT);
      if (S.beltBreakTimer) { clearTimeout(S.beltBreakTimer); S.beltBreakTimer = null; }
    }
    S.displayPage = 1; // Volver a la página del motor
    updateDisplayPage();
  } else {
    btn.classList.remove('pressed');
    elog('Botón E-Stop liberado. Requiere RESET en panel.', 'info');
    setAlarm('FALLA PRESENTE — REQUIERE RESET', 'fault');
  }
  updateManualBtns();
  updateLamps();
}

function setMode(m) {
  if (S.starting||S.stopping||S.estop) return;
  S.mode = m;
  ['off','manual','auto'].forEach(k => {
    document.getElementById('mb-'+k).classList.toggle('on', k===m);
  });
  document.getElementById('l-auto').className = 'lamp-dot'+(m==='auto'?' b':'');
  updateManualBtns();

  if (m==='auto') {
    elog('Modo AUTO activado — Monitoreando red eléctrica','info');
    checkAuto();
  } else if (m==='off') {
    clearTimeout(S.autoStartT); clearTimeout(S.autoStopT);
    S.autoStartT=S.autoStopT=null;
    if (S.engine) manualStop();
    elog('Modo PARAR seleccionado','warn');
  } else {
    elog('Modo MANUAL activado','info');
  }
}

function updateManualBtns() {
  const isMan = S.mode==='manual';
  document.getElementById('btn-start').disabled = !isMan||S.engine||S.starting||S.fault||S.estop;
  document.getElementById('btn-stop').disabled  = !isMan||(!S.engine&&!S.starting)||S.estop;
}

function manualStart() {
    // NUEVO: Lógica para la verificación de energía cero en LOTO
  if (S.loto.stage === 'verify' && !S.loto.verificationAttempted) {
      S.loto.verificationAttempted = true;
      elog('LOTO: Intento de arranque bloqueado. Verificación de energía cero exitosa.', 'ok');
      openModal('loto'); // Reabrir el modal para mostrar el éxito
      return;
  }
  if (S.engine||S.starting||S.fault||S.estop) return;
  elog('▶ ARRANQUE MANUAL solicitado','info');
  clearInterval(coolDownInt); // Detener ciclo de enfriamiento si estaba activo
  startEngine();
}
function manualStop() {
  if (!S.engine&&!S.starting) return;
  elog('■ PARO MANUAL solicitado','warn');
  stopEngine();
}
function startEngine() {
  if (S.engine||S.starting||S.estop) return;
  S.starting=true; S.fault=false;
  S.crankingAttempts = 0; // Reset cranking attempts
  setAlarm('ARRANCANDO — Cranking motor...','warn');
  updateManualBtns();
  elog('Prelubricación activa...','info');

  setTimeout(()=>{ if(!S.estop) elog('Motor girando — buscando combustión','info') },900);
  setTimeout(()=>{ if(!S.estop) elog('Combustión detectada — estabilizando RPM','ok') },2200);

  // --- NUEVO: Lógica de Fallo de Arranque ---
  const startDelay = 3600; // ms
  const maxCrankingAttempts = 3;
  const lowBatteryThreshold = 23.0; // Volts
  const lowOilThreshold = 30; // %

  const attemptStart = () => {
    if (!S.starting || S.estop) return; // Evitar arranques fantasma
    S.crankingAttempts++;

    // Check for critical pre-start issues
    if (S.oilLevel < lowOilThreshold && !DONE['oil']) {
      S.lowOilPressureFault = true;
      S.fault = true;
      setAlarm('FALLA: Baja presión de aceite (nivel bajo)', 'fault');
      elog('🚨 FALLA CRÍTICA: Nivel de aceite bajo. Motor no arrancará para evitar daños.', 'err');
      S.starting = false;
      updateManualBtns();
      updateLamps();
      return;
    }

    const startProbability = (S.battVolt > lowBatteryThreshold) ? 0.95 : 0.4; // Higher chance with good battery
    if (Math.random() < startProbability || S.crankingAttempts >= maxCrankingAttempts) { 

      // Check for water in fuel right after combustion is achieved
      if (ISSUES['fuel'] === 'water' && !S.fuelWaterDrained) {
          elog('Motor arranca pero inestable... humo blanco visible.', 'warn');
          S.engine = true; // Engine is technically running for a bit
          document.getElementById('run-strip').classList.add('on');
          updateLamps();
          startValues(); // Start the physics loop to see values fluctuate

          setTimeout(() => {
              if (!S.engine) return; // Check if it was stopped by something else
              S.fault = true;
              setAlarm('FALLA: AGUA EN COMBUSTIBLE', 'fault');
              elog('🚨 FALLA CRÍTICA: Motor se apaga por agua en el sistema de inyección.', 'err');
              stopEngine();
          }, 8000); // Stop after 8 seconds
          S.starting = false;
          updateManualBtns();
          return; // Exit before normal operation is logged
      }

      clearInterval(coolDownInt);
      S.starting = false; S.engine = true;
      setAlarm('SISTEMA OK — MOTOR EN MARCHA','ok');
      elog('Motor operando a 1800 RPM ✅','ok');
      document.getElementById('run-strip').classList.add('on');
      document.getElementById('chip-eng').textContent='MOTOR: EN MARCHA';
      document.getElementById('chip-eng').className='stat-chip chip-ok';
      updateLamps();
      updateManualBtns();
      startValues();
      updateGrid();
    } else {
      elog(`Intento de arranque fallido (${S.crankingAttempts}/${maxCrankingAttempts}). Reintentando...`, 'warn');
      if (S.crankingAttempts < maxCrankingAttempts) {
        setTimeout(attemptStart, startDelay);
      } else {
        S.startFailure = true; S.fault = true;
        setAlarm('FALLA: Fallo de arranque (3 intentos)', 'fault');
        elog('🚨 FALLA CRÍTICA: Motor no arranca después de 3 intentos. Revisar batería/combustible.', 'err');
        S.starting = false;
        updateManualBtns();
        updateLamps();
      }
    }
  };
  setTimeout(attemptStart, startDelay);
}

function stopEngine() {
  if (!S.engine&&!S.starting) return;
  if (S.beltBreakTimer) { clearTimeout(S.beltBreakTimer); S.beltBreakTimer = null; }
  S.stopping=true; S.engine=false;
  stopValues();
  startCooldown();
  setAlarm('PARANDO — Ciclo de enfriamiento...','info');
  elog('Iniciando paro — enfriamiento activo (30s)','warn');
  updateManualBtns();

  setTimeout(()=>{
    if(S.estop) return;
    S.stopping=false;
    document.getElementById('run-strip').classList.remove('on');
    document.getElementById('chip-eng').textContent='MOTOR: APAGADO';
    document.getElementById('chip-eng').className='stat-chip chip-off';
    setAlarm('SISTEMA OK — MOTOR DETENIDO','ok');
    elog('Motor detenido completamente','ok');
    clearDisps();
    updateLamps();
    updateManualBtns();
    updateGrid();
    if (S.mode==='auto' && !S.fault) checkAuto(); // Only check auto if no fault
  }, 3000); // Mantenemos tu tiempo acelerado visual
}
function resetFault() {
  if (!S.fault) return;
  if (S.estop) {
    elog('Rechazado: Botón E-Stop sigue presionado', 'err');
    return;
  }
  S.fault=false; S.overloadTimer=0; S.crankingAttempts=0;
  S.lowOilPressureFault = false;
  S.highTempWarning = false;
  S.highTempFault = false;
  S.lowCoolantWarning = false;
  S.startFailure = false;
  S.beltBroken = false;
  setAlarm('FALLA RESETEADA','ok');
  elog('Reset de falla por operador','warn');
  document.getElementById('l-fault').className='lamp-dot';
  updateManualBtns();
}

let coolDownInt = null; // Moved outside for global access
function startCooldown(loadAtShutdown = 0) { // Added loadAtShutdown parameter
  if (coolDownInt) clearInterval(coolDownInt); // Evitar fuga de memoria con multiples intervalos
  coolDownInt = setInterval(() => {
    if (S.engine) { // Si el motor vuelve a arrancar, se detiene el enfriamiento
      clearInterval(coolDownInt);
      return;
    }
    S.engineTemp += (AMBIENT_TEMP - S.engineTemp) * 0.02; // Enfriamiento gradual
    document.getElementById('d-temp').textContent = S.engineTemp.toFixed(1);

    // Intelligent cooldown duration based on loadAtShutdown
    const cooldownFactor = 1 + (loadAtShutdown / 100) * 2; // 1x for no load, 3x for full load
    if (Math.abs(S.engineTemp - AMBIENT_TEMP) < 1 || (Date.now() - S.stoppingTime > (3000 * cooldownFactor))) { // 3s base cooldown * factor
      S.engineTemp = AMBIENT_TEMP;
      document.getElementById('d-temp').textContent = S.engineTemp.toFixed(1);
      clearInterval(coolDownInt);
    }
  }, 1000);
}

let valInt=null;
function startValues() {
  if (valInt) clearInterval(valInt); // Evitar superposición de intervalos físicos
  S.targetV = NOMINAL_V;
  S.targetHz = NOMINAL_HZ;
  S.actualV = 0;
  S.actualHz = 0;
  updateVals();
  // Se cambia a 200ms para soportar respuesta transitoria y física
  valInt = setInterval(updateVals, 200);
}
function stopValues() { clearInterval(valInt); valInt=null; }

function updateMeshColors() {
    if (!generadorModel) return;
    generadorModel.traverse((child) => {
        if (child.isMesh) {
            let node = child;
            let key = null;
            while (node) {
                let nombreNormalizado = (node.name || '').replace(/_/g, ' ');
                key = MESH_TO_KEY_MAP[node.name] || MESH_TO_KEY_MAP[nombreNormalizado];
                if (key) break;
                node = node.parent;
            }
            if (key) {
                if (child.material && child.material.emissive) {
                    if (!child.userData.materialCloned) {
                        child.material = child.material.clone();
                        child.userData.materialCloned = true;
                        child.userData.originalEmissive = child.material.emissive.getHex();
                    }
                    child.userData.mapKey = key;
                    if (child === hoveredMesh) return; // Omitir el actual si el ratón está encima
                    if (DONE[key] === 'ok') child.material.emissive.setHex(0x002208); // Tono verde permanente
                    else if (DONE[key] === 'issue') child.material.emissive.setHex(0x220800); // Tono rojo permanente
                    else child.material.emissive.setHex(child.userData.originalEmissive);
                }
            }
        }
    });
}

// Funciones utilitarias originales
function rv(b,r) { return (b+(Math.random()-.5)*r).toFixed(1); }
function ri2(b,r) { return String(Math.round(b+(Math.random()-.5)*r)); }

function updateLoad() {
  const slider = document.getElementById('load-slider');
  const oldPct = S.loadPct;
  S.loadPct = parseInt(slider.value);
  
  document.getElementById('lbl-load-pct').textContent = S.loadPct;
  document.getElementById('lbl-load-kw').textContent = Math.round((S.loadPct/100) * NOMINAL_KW) + ' kW';
  
  // Simular transitorio (Caída de voltaje y Hz al meter carga de golpe)
  if (S.engine && !S.fault) {
    const delta = S.loadPct - oldPct;
    if (Math.abs(delta) > 10) {
      S.actualV -= (delta * 0.4);
      S.actualHz -= (delta * 0.05);
      elog(`Escalón de carga de ${delta > 0 ? '+' : ''}${delta}%. Ajustando AVR y gobernador...`, 'warn');
    }
  }
}

function updateVals() {
  if (!S.engine || S.fault) return;

  // --- Realismo de Temperatura ---
  // Termodinámica avanzada con válvula termostática
  let thermostatOpen = Math.max(0.1, Math.min(1.0, (S.engineTemp - 80) / 10)); // Abre entre 80C y 90C
  let coolingFlow = thermostatOpen;
  if (S.radiatorBlocked) coolingFlow *= 0.6;
  if (S.coolantLevel < 40 && !DONE['coolant']) coolingFlow *= 0.5;
  if (S.beltBroken) coolingFlow *= 0.05; // Sin bomba de agua

  const heatGenerated = 5 + (S.loadPct / 100) * 45; // Calor generado dinámico (5 a 50)
  const targetTemp = AMBIENT_TEMP + (heatGenerated / coolingFlow) * 1.26;
  S.engineTemp += (targetTemp - S.engineTemp) * 0.02; // Inercia térmica del bloque

  // High Temp Warning/Fault
  if (S.engineTemp > HIGH_TEMP_WARNING_THRESHOLD && !S.highTempWarning) {
    S.highTempWarning = true;
    setAlarm('ADVERTENCIA: Alta temperatura del motor', 'warn');
    elog(`⚠️ ADVERTENCIA: Temperatura del motor (${S.engineTemp.toFixed(1)}°C) elevada.`, 'warn');
  }

  // --- Realismo de Presión de Aceite ---
  const tempFactor = Math.max(0, Math.min(1, (S.engineTemp - AMBIENT_TEMP) / (OPERATING_TEMP - AMBIENT_TEMP)));
  const basePressure = 70 - (tempFactor * 20); // 70 PSI en frío, 50 en caliente
  const loadPressure = (S.loadPct / 100) * 10; // Carga al 100% sube 10 PSI
  
  let oilLevelFactor = 1.0;
  if (S.oilLevel < 35 && !DONE['oil']) {
      // Pérdida exponencial de presión por nivel bajo
      oilLevelFactor = Math.max(0, S.oilLevel / 35);
  }
  S.oilPressure = (basePressure + loadPressure) * Math.pow(oilLevelFactor, 2);

  // --- Realismo de Consumo y Horas ---
  let fuelRate = 5 + (S.loadPct / 100) * 45; // 5 L/h en ralentí, 50 L/h a plena carga
  if (S.fuelLeakRate > 0 && !DONE['leaks']) fuelRate += S.fuelLeakRate; // Add leak rate if issue not fixed

  // Consumo físico: S.fuel está en %, por lo que 500L = 100%. fuelRate(L/h) equivale a (fuelRate/5) %/h.
  S.fuel = Math.max(0, S.fuel - ((fuelRate / 5) / 3600) * 0.2); // Actualización cada 200ms
  S.engineHours += (200 / 1000 / 3600); // Intervalo de 200ms en horas

  // --- NUEVO: Fallas por niveles bajos ---
  if (S.oilPressure < LOW_OIL_PRESSURE_THRESHOLD && !S.lowOilPressureFault && S.engine) {
    S.lowOilPressureFault = true;
    S.fault = true;
    setAlarm('FALLA: Baja presión de aceite', 'fault');
    elog('🚨 FALLA CRÍTICA: Baja presión de aceite. Apagando motor.', 'err');
    stopEngine();
  }
  if (S.engineTemp > HIGH_TEMP_FAULT_THRESHOLD && !S.highTempFault && S.engine) {
    S.highTempFault = true;
    S.fault = true;
    setAlarm('FALLA: Alta temperatura del motor', 'fault');
    elog('🚨 FALLA CRÍTICA: Alta temperatura del motor. Apagando motor.', 'err');
    stopEngine();
  }
  if (S.fuel <= 0 && S.engine) {
    S.fault = true;
    setAlarm('FALLA: Bajo nivel de combustible', 'fault');
    elog('🚨 FALLA CRÍTICA: Motor se detiene por falta de combustible.', 'err');
    stopEngine();
  }

  // --- NUEVO: Alarma de Mantenimiento ---
  if (S.engineHours >= 250 && !S.maintenanceAlarmTriggered) {
    S.maintenanceAlarmTriggered = true;
    elog('⚠️ ADVERTENCIA: Mantenimiento requerido (250 horas).', 'warn');
  }
  // --- Física de estabilización de voltaje y frecuencia ---
  S.actualV += (S.targetV - S.actualV) * 0.2;
  S.actualHz += (S.targetHz - S.actualHz) * 0.2;
  
  const noiseV = (Math.random() - 0.5) * (S.loadPct > 80 ? 2 : 0.5);
  const noiseHz = (Math.random() - 0.5) * (S.loadPct > 80 ? 0.2 : 0.05);
  
  let dispV = S.actualV + noiseV;
  let dispHz = S.actualHz + noiseHz;
  let dispKw = (S.loadPct / 100) * NOMINAL_KW + (Math.random() * 2); // Base kW
  if (S.airFilterBlocked && !DONE['airfilter']) { // Air filter issue reduces max power
    dispKw = Math.min(dispKw, NOMINAL_KW * 0.7); // Max 70% power
  }
  let dispV_LL = dispV * Math.sqrt(3);

  if (S.grid && S.mode !== 'manual') {
     dispKw = 0; // La carga la lleva CFE
  }

  const currentRpm = dispHz * 30;
  document.getElementById('run-rpm').textContent = currentRpm.toFixed(0) + ' RPM';
  const runFill = document.querySelector('#run-strip .run-fill');
  if (runFill) {
      const baseWidth = 90; // %
      const rpmDeviation = currentRpm - 1800; // Nominal is 1800
      const widthVariation = (rpmDeviation / 50) * 5; // For every 50 RPM deviation, change width by 5%
      let newWidth = baseWidth + widthVariation;
      newWidth = Math.max(80, Math.min(100, newWidth)); // Clamp between 80% and 100%
      runFill.style.width = newWidth + '%';
  }

  // --- Actualización de Displays ---
  // Página del Generador
  document.getElementById('d-v1').textContent = dispV.toFixed(0);
  document.getElementById('d-v2').textContent = (dispV + (Math.random()*2-1)).toFixed(0);
  document.getElementById('d-v3').textContent = (dispV + (Math.random()*2-1)).toFixed(0);
  document.getElementById('d-v12').textContent = dispV_LL.toFixed(0);
  document.getElementById('d-v23').textContent = (dispV_LL + (Math.random()*3-1.5)).toFixed(0);
  document.getElementById('d-v31').textContent = (dispV_LL + (Math.random()*3-1.5)).toFixed(0);
  document.getElementById('d-freq').textContent = dispHz.toFixed(1);
  document.getElementById('d-kw').textContent = dispKw.toFixed(0);

  // Página del Motor
  document.getElementById('d-rpm').textContent = currentRpm.toFixed(0);
  const te = document.getElementById('d-temp');
  te.textContent = S.engineTemp.toFixed(1); // Update temperature display
  te.className = 'd-val'+(S.engineTemp > HIGH_TEMP_WARNING_THRESHOLD ? ' warn' : S.engineTemp > HIGH_TEMP_FAULT_THRESHOLD ? ' err' : '');
  const op = document.getElementById('d-oil');
  op.textContent = S.oilPressure.toFixed(0);
  op.className = 'd-val'+(S.oilPressure < LOW_OIL_PRESSURE_THRESHOLD ? ' err' : S.oilPressure < (LOW_OIL_PRESSURE_THRESHOLD + 10) ? ' warn' : '');
  document.getElementById('d-batt').textContent = S.engine ? rv(27.8, 0.4) : S.battVolt.toFixed(1); // Voltaje de carga si motor encendido, sino voltaje de reposo
  document.getElementById('d-hours').textContent = S.engineHours.toFixed(1);
  document.getElementById('d-fuelrate').textContent = fuelRate.toFixed(1);
  
  // Barra de combustible
  const fp = Math.round(S.fuel);
  document.getElementById('fs-pct').textContent = fp+'%';
  document.getElementById('fs-pct').style.color = fp<20?'var(--red)':fp<40?'var(--amber)':'var(--green)';
  const ff = document.getElementById('fs-fill');
  ff.style.width = fp+'%';
  ff.style.background = fp<20?'var(--red)':fp<40?'var(--amber)':'var(--green)';

  // --- NUEVO: Falla de Correas ---
  if (ISSUES['belts'] && !DONE['belts'] && S.engine && !S.beltBroken) {
    if (!S.beltBreakTimer) {
      // Set a random time for the belt to break (e.g., 60 to 300 seconds)
      S.beltBreakTimer = setTimeout(() => {
        S.beltBroken = true;
        S.fault = true;
        setAlarm('FALLA: Correa rota (Alternador/Bomba)', 'fault');
        elog('🚨 FALLA CRÍTICA: Correa del motor rota. Pérdida de carga de batería y sobrecalentamiento.', 'err');
        stopEngine(); // Engine will stop due to overheating/no charge
      }, (60 + Math.random() * 240) * 1000); // Convert to milliseconds
    }
  } else if (S.beltBroken && S.engine) { // If belt broken and engine still running (shouldn't happen but for safety)
    S.fault = true;
    setAlarm('FALLA: Correa rota (Alternador/Bomba)', 'fault');
    elog('🚨 FALLA CRÍTICA: Correa del motor rota. Pérdida de carga de batería y sobrecalentamiento.', 'err');
    stopEngine();
  }


  // Lógica de Sobrecarga (Overload)
  if (S.loadPct > 100 && dispKw > 0) {
    S.overloadTimer += 0.2;
    document.getElementById('d-kw').className = 'd-val err';
    if (S.overloadTimer >= 1.0 && S.overloadTimer < 1.2) elog('⚠️ ADVERTENCIA: Operación en Sobrecarga', 'warn');
    if (S.overloadTimer > 8.0) { // Disparo a los 8 segundos
      S.fault = true;
      setAlarm('DISPARO POR SOBRECORRIENTE (ANSI 51)', 'fault');
      elog('🚨 FALLA CRÍTICA: Disparo por sobrecarga térmica del alternador', 'err');
      stopEngine(); // En un caso real el contactor abre, aquí lo apagamos por protección
      S.engine = false; S.starting = false;
      document.getElementById('run-strip').classList.remove('on');
      updateManualBtns();
      updateLamps();
      updateGrid();
    }
  } else {
    S.overloadTimer = 0;
    document.getElementById('d-kw').className = 'd-val';
  }
}

function clearDisps() {
  ['d-v1','d-v2','d-v3','d-freq','d-kw','d-rpm','d-oil', 'd-v12', 'd-v23', 'd-v31', 'd-fuelrate'].forEach(id=>{
    const el = document.getElementById(id);
    if (el) {
        el.textContent='---';
        el.className='d-val';
    }
  });
  // No reseteamos la temperatura aquí, el cooldown lo maneja
  // Reseteamos horas a su último valor
  const h = document.getElementById('d-hours');
  if(h) h.textContent = S.engineHours.toFixed(1);
  
  document.getElementById('d-batt').textContent = S.battVolt.toFixed(1); // Restaurar voltaje de reposo
  // Limpiar también la página de red
  document.getElementById('d-grid-v').textContent = '---';
  document.getElementById('d-grid-f').textContent = '---';
  document.getElementById('d-grid-st').textContent = '---';
  document.getElementById('d-grid-st').className = 'd-val';
}

function setAlarm(txt, cls) {
  const led = document.getElementById('alarm-led');
  const atxt = document.getElementById('alarm-txt');
  atxt.textContent = txt;
  atxt.className = 'alarm-txt '+cls;
  led.className = 'alarm-led'+(cls==='ok'?'':' '+cls);
}

function updateLamps() {
  document.getElementById('l-ready').className = 'lamp-dot'+(S.checkDone&&!S.fault?' g':' a');
  document.getElementById('l-run').className   = 'lamp-dot'+(S.engine?' g':'');
  document.getElementById('l-fault').className = 'lamp-dot'+(S.fault || S.highTempWarning || S.lowCoolantWarning || S.maintenanceAlarmTriggered ? ' r' : ''); // More conditions for fault lamp
  document.getElementById('l-mains').className = 'lamp-dot'+(S.grid?' g':'');
  // Ajuste en indicador Gen Activo considerando carga
  const enCarga = S.engine && (!S.grid || S.mode==='manual') && !S.fault;
  document.getElementById('l-gen').className   = 'lamp-dot'+(enCarga?' g':'');
  document.getElementById('l-auto').className  = 'lamp-dot'+(S.mode==='auto'?' b':'');
}

// ── GRID ──
function toggleGrid() {
  S.grid = !S.grid;
  document.getElementById('grid-sw').classList.toggle('on', S.grid);
  updateGrid();

  if (S.grid) {
    elog('⚡ RED ELÉCTRICA RESTAURADA — 480V 60Hz','ok');
    document.getElementById('chip-grid').textContent='RED: PRESENTE';
    document.getElementById('chip-grid').className='stat-chip chip-ok';
    S.gridLostAt=null;
    clearTimeout(S.autoStartT); S.autoStartT=null;
    if (S.mode==='auto'&&S.engine) {
      elog('AUTO: Red presente — iniciando cuenta regresiva de transferencia (30s)','info');
      S.autoStopT = setTimeout(()=>{
        elog('AUTO: Transfiriendo carga a la red eléctrica...','info');
        updateGrid();
        setTimeout(()=>{ if(S.engine){elog('AUTO: Parando generador post-transferencia','ok');stopEngine();} },1500);
      }, 30000);
    }
  } else {
    elog('🔴 ¡RED ELÉCTRICA PERDIDA! — Fallo de suministro detectado','err');
    document.getElementById('chip-grid').textContent='RED: FALLA';
    document.getElementById('chip-grid').className='stat-chip chip-err';
    S.gridLostAt=Date.now();
    clearTimeout(S.autoStopT); S.autoStopT=null;
    if (S.mode==='auto') {
      elog('AUTO: Confirmando falla de red... espera 10s','warn');
      S.autoStartT = setTimeout(()=>{
        elog('🚨 AUTO: Arranque de emergencia — falla de red confirmada','err');
        document.getElementById('gr-tr').textContent='TRANSFIRIENDO A GEN...';
        document.getElementById('gr-tr').className='gr-v a';
        startEngine();
        setTimeout(()=>{
          if(S.engine){document.getElementById('gr-tr').textContent='EN GENERADOR';document.getElementById('gr-tr').className='gr-v a';}
        },4200);
      }, 10000);
    }
  }
  updateLamps();
}

function updateGrid() {
  const g = S.grid;
  document.getElementById('gr-st').textContent = g?'PRESENTE':'AUSENTE / FALLA';
  document.getElementById('gr-st').className   = 'gr-v '+(g?'g':'r');
  document.getElementById('gr-v').textContent  = g?'277 V':'0 V';
  document.getElementById('gr-f').textContent  = g?'60.0 Hz':'0.0 Hz';

  const tr = document.getElementById('gr-tr');
  if (g && (!S.engine || S.mode==='auto')) { tr.textContent='EN RED ELÉCTRICA'; tr.className='gr-v g'; }
  else if (!g && S.engine && !S.fault) { tr.textContent='EN GENERADOR';     tr.className='gr-v a'; }
  else if (S.engine && S.mode==='manual') { tr.textContent='EN GENERADOR (MANUAL)'; tr.className='gr-v a'; }
  else if (!g && !S.engine){ tr.textContent='SIN ALIMENTACIÓN'; tr.className='gr-v r'; }

  // Actualizar la página de red del display principal si está visible
  updateGridPageDisplay();
}

setInterval(()=>{
  if (!S.grid&&S.gridLostAt) {
    const e=Math.floor((Date.now()-S.gridLostAt)/1000);
    document.getElementById('gr-time').textContent=`${String(Math.floor(e/60)).padStart(2,'0')}:${String(e%60).padStart(2,'0')} sin red`;
  }
}, 1000);

function checkAuto() {
  if (S.mode!=='auto' || S.fault) return; // Don't check auto if there's a fault
  if (!S.grid&&!S.engine&&!S.starting) {
    elog('AUTO: Red ausente al activar modo AUTO — monitoreando','warn');
  }
}

// ── LOG ──
function elog(msg, cls) {
  const log = document.getElementById('elog');
  const e=Math.floor((Date.now()-S.logStart)/1000);
  const t=`${String(Math.floor(e/3600)).padStart(2,'0')}:${String(Math.floor((e%3600)/60)).padStart(2,'0')}:${String(e%60).padStart(2,'0')}`;
  const line=document.createElement('div');
  line.className='elog-line '+cls;
  line.innerHTML=`<span class="elog-time">${t}</span>${msg}`;
  log.appendChild(line);
  log.scrollTop=log.scrollHeight;
}

// ══════════════════════════════════════════════
//  BOOT
// ══════════════════════════════════════════════
init();
// Auto-expand first step
setTimeout(()=>{
  const first = document.getElementById('sc-'+STEPS[0].key);
  if (first) first.classList.add('expanded','active-step');
},400);
if (!S.examMode) {
  setTimeout(()=>{
    const first = document.getElementById('sc-'+STEPS[0].key);
    if (first) first.classList.add('expanded','active-step');
  },400);
}
