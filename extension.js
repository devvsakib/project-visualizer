// extension.js - Enhanced Project Visualizer with Performance & Animations
const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
/** @type {any} */

function activate(context) {
    let currentPanel = null;
    let currentRootPath = null;

    let disposable = vscode.commands.registerCommand('projectVisualizer.showGraph', () => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('No workspace folder open');
            return;
        }

        currentRootPath = workspaceFolders[0].uri.fsPath;

        if (currentPanel) {
            currentPanel.reveal(vscode.ViewColumn.One);
        } else {
            currentPanel = vscode.window.createWebviewPanel(
                'projectVisualizer',
                'Project Flow Visualizer',
                vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true
                }
            );

            currentPanel.onDidDispose(() => {
                currentPanel = null;
            });

            const projectData = analyzeProject(currentRootPath);
            currentPanel.webview.html = getWebviewContent(projectData, currentRootPath);

            currentPanel.webview.onDidReceiveMessage(
                async message => {
                    switch (message.command) {
                        case 'openFile':
                            const filePath = path.join(currentRootPath, message.file);
                            vscode.workspace.openTextDocument(filePath).then(doc => {
                                vscode.window.showTextDocument(doc);
                            });
                            break;
                        case 'changeDirectory':
                            const selected = await vscode.window.showOpenDialog({
                                canSelectFiles: false,
                                canSelectFolders: true,
                                canSelectMany: false,
                                openLabel: 'Select Folder to Visualize',
                                defaultUri: vscode.Uri.file(currentRootPath)
                            });

                            if (selected && selected[0]) {
                                currentRootPath = selected[0].fsPath;
                                const newProjectData = analyzeProject(currentRootPath);
                                currentPanel.webview.html = getWebviewContent(newProjectData, currentRootPath);
                            }
                            break;
                    }
                },
                undefined,
                context.subscriptions
            );
        }
    });

    context.subscriptions.push(disposable);
}

function analyzeProject(rootPath) {
    const tree = {
        name: path.basename(rootPath),
        type: 'root',
        children: [],
        path: '',
        expanded: true,
        id: 'root'
    };
    let idCounter = 0;

    function buildTree(dir, node, depth = 0) {
        if (depth > 3) return; // Increased to 3 levels

        try {
            const items = fs.readdirSync(dir).sort();

            for (const item of items) {
                if (item.startsWith('.') ||
                    ['node_modules', 'dist', 'build', 'coverage', '.git', 'out', 'bin', 'obj', '__pycache__', 'target', 'venv'].includes(item)) {
                    continue;
                }

                const fullPath = path.join(dir, item);
                let stat;
                try {
                    stat = fs.statSync(fullPath);
                } catch (e) {
                    continue;
                }

                const relativePath = path.relative(rootPath, fullPath);

                if (stat.isDirectory()) {
                    const folderNode = {
                        name: item,
                        type: 'folder',
                        children: [],
                        path: relativePath,
                        expanded: depth < 1, // Auto-expand only first level
                        id: `folder-${idCounter++}`
                    };
                    node.children.push(folderNode);
                    buildTree(fullPath, folderNode, depth + 1);
                } else if (stat.isFile()) {
                    const ext = path.extname(item);
                    if (['.js', '.ts', '.jsx', '.tsx', '.vue', '.py', '.java', '.cpp', '.c', '.h',
                        '.cs', '.go', '.rs', '.php', '.rb', '.swift', '.kt', '.css', '.scss',
                        '.html', '.json', '.md', '.sql', '.xml', '.yaml', '.yml'].includes(ext)) {
                        const fileNode = {
                            name: item,
                            type: getFileType(ext),
                            path: relativePath,
                            imports: [],
                            id: `file-${idCounter++}`
                        };

                        try {
                            const content = fs.readFileSync(fullPath, 'utf-8');
                            fileNode.imports = extractImports(content, ext, dir, rootPath);
                        } catch (e) { }

                        node.children.push(fileNode);
                    }
                }
            }
        } catch (e) { }
    }

    buildTree(rootPath, tree);
    return tree;
}

function getFileType(ext) {
    const typeMap = {
        '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
        '.ts': 'typescript',
        '.jsx': 'react', '.tsx': 'react',
        '.vue': 'vue',
        '.py': 'python',
        '.java': 'java',
        '.cpp': 'cpp', '.c': 'cpp', '.h': 'cpp',
        '.cs': 'csharp',
        '.go': 'go',
        '.rs': 'rust',
        '.php': 'php',
        '.rb': 'ruby',
        '.swift': 'swift',
        '.kt': 'kotlin',
        '.css': 'style', '.scss': 'style',
        '.html': 'html',
        '.json': 'config', '.xml': 'config', '.yaml': 'config', '.yml': 'config',
        '.md': 'markdown',
        '.sql': 'database'
    };
    return typeMap[ext] || 'file';
}

function extractImports(content, ext, currentDir, rootPath) {
    const imports = [];
    const importRegex = /import\s+.*?from\s+['"](.+?)['"]/g;
    const requireRegex = /require\s*\(\s*['"](.+?)['"]\s*\)/g;

    let match;
    while ((match = importRegex.exec(content)) !== null) {
        const resolved = resolveImportPath(currentDir, match[1], rootPath);
        if (resolved) imports.push(resolved);
    }
    while ((match = requireRegex.exec(content)) !== null) {
        const resolved = resolveImportPath(currentDir, match[1], rootPath);
        if (resolved) imports.push(resolved);
    }

    return [...new Set(imports)];
}

function resolveImportPath(currentDir, importPath, rootPath) {
    if (importPath.startsWith('.')) {
        const resolved = path.resolve(currentDir, importPath);
        const extensions = ['', '.js', '.ts', '.jsx', '.tsx', '.vue', '.json'];

        for (const ext of extensions) {
            const fullPath = resolved + ext;
            if (fs.existsSync(fullPath)) {
                return path.relative(rootPath, fullPath);
            }
        }
    }
    return null;
}

function getWebviewContent(projectData, rootPath) {
    const projectName = path.basename(rootPath);

    return `<!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                
                :root {
                    --bg-primary: #1e1e1e;
                    --bg-secondary: #252526;
                    --bg-tertiary: #2d2d30;
                    --border-color: #3e3e42;
                    --text-primary: #cccccc;
                    --text-secondary: #888888;
                    --accent: #007acc;
                    --grid-color: rgba(255, 255, 255, 0.05);
                    --connection-color: rgba(255, 255, 255, 0.15);
                    --import-color: rgba(100, 200, 255, 0.4);
                    --shadow: rgba(0, 0, 0, 0.3);
                }
                
                body.light-theme {
                    --bg-primary: #f3f3f3;
                    --bg-secondary: #ffffff;
                    --bg-tertiary: #e8e8e8;
                    --border-color: #d0d0d0;
                    --text-primary: #333333;
                    --text-secondary: #666666;
                    --accent: #0078d4;
                    --grid-color: rgba(0, 0, 0, 0.05);
                    --connection-color: rgba(0, 0, 0, 0.15);
                    --import-color: rgba(0, 120, 212, 0.3);
                    --shadow: rgba(0, 0, 0, 0.1);
                }
                
                body {
                    overflow: hidden;
                    background: var(--bg-primary);
                    font-family: 'Segoe UI', system-ui, sans-serif;
                    color: var(--text-primary);
                    transition: background 0.3s ease, color 0.3s ease;
                }
                
                #canvas {
                    width: 100vw;
                    height: 100vh;
                    cursor: grab;
                    display: block;
                }
                #canvas:active { cursor: grabbing; }
                
                .controls {
                    position: absolute;
                    top: 16px;
                    left: 16px;
                    display: flex;
                    gap: 8px;
                    z-index: 100;
                    flex-wrap: wrap;
                    max-width: 600px;
                }
                
                .controls button {
                    padding: 10px 16px;
                    background: var(--bg-tertiary);
                    color: var(--text-primary);
                    border: 1px solid var(--border-color);
                    border-radius: 6px;
                    cursor: pointer;
                    font-size: 12px;
                    font-weight: 500;
                    transition: all 0.2s ease;
                    box-shadow: 0 2px 4px var(--shadow);
                    display: flex;
                    align-items: center;
                    gap: 6px;
                }
                
                .controls button:hover {
                    background: var(--accent);
                    color: white;
                    transform: translateY(-1px);
                    box-shadow: 0 4px 8px var(--shadow);
                }
                
                .controls button:active {
                    transform: translateY(0);
                }
                
                .controls button.active {
                    background: var(--accent);
                    color: white;
                }
                
                .info {
                    position: absolute;
                    top: 16px;
                    right: 16px;
                    background: var(--bg-tertiary);
                    padding: 14px 18px;
                    border-radius: 8px;
                    border: 1px solid var(--border-color);
                    font-size: 12px;
                    z-index: 100;
                    color: var(--text-primary);
                    box-shadow: 0 4px 12px var(--shadow);
                    backdrop-filter: blur(10px);
                    min-width: 200px;
                }
                
                .info .project-name {
                    font-weight: 600;
                    font-size: 14px;
                    margin-bottom: 8px;
                    color: var(--accent);
                }
                
                .info .stat {
                    display: flex;
                    justify-content: space-between;
                    margin: 6px 0;
                    padding: 4px 0;
                    border-bottom: 1px solid var(--border-color);
                }
                
                .info .stat:last-child {
                    border-bottom: none;
                }
                
                .info .stat-label {
                    color: var(--text-secondary);
                }
                
                .info .stat-value {
                    font-weight: 600;
                    color: var(--text-primary);
                }
                
                .minimap {
                    position: absolute;
                    bottom: 16px;
                    right: 16px;
                    width: 180px;
                    height: 120px;
                    background: var(--bg-tertiary);
                    border: 1px solid var(--border-color);
                    border-radius: 6px;
                    box-shadow: 0 4px 12px var(--shadow);
                    z-index: 100;
                    opacity: 0.9;
                }
                
                .search-box {
                    position: absolute;
                    bottom: 16px;
                    left: 16px;
                    background: var(--bg-tertiary);
                    border: 1px solid var(--border-color);
                    border-radius: 6px;
                    padding: 10px 14px;
                    min-width: 250px;
                    box-shadow: 0 4px 12px var(--shadow);
                    z-index: 100;
                }
                
                .search-box input {
                    width: 100%;
                    background: var(--bg-secondary);
                    border: 1px solid var(--border-color);
                    border-radius: 4px;
                    padding: 8px 12px;
                    color: var(--text-primary);
                    font-size: 12px;
                    outline: none;
                }
                
                .search-box input:focus {
                    border-color: var(--accent);
                }
                
                .search-results {
                    max-height: 200px;
                    overflow-y: auto;
                    margin-top: 8px;
                }
                
                .search-result {
                    padding: 6px 8px;
                    cursor: pointer;
                    border-radius: 4px;
                    font-size: 11px;
                    transition: background 0.15s;
                }
                
                .search-result:hover {
                    background: var(--bg-secondary);
                }
                
                .tooltip {
                    position: absolute;
                    background: var(--bg-tertiary);
                    border: 1px solid var(--border-color);
                    border-radius: 6px;
                    padding: 8px 12px;
                    font-size: 11px;
                    pointer-events: none;
                    z-index: 1000;
                    box-shadow: 0 4px 12px var(--shadow);
                    display: none;
                    max-width: 300px;
                }
                
                .loading {
                    position: absolute;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    font-size: 14px;
                    color: var(--text-secondary);
                    display: none;
                }
                
                @keyframes spin {
                    to { transform: rotate(360deg); }
                }
                
                .loading::before {
                    content: '◐';
                    display: inline-block;
                    margin-right: 8px;
                    animation: spin 1s linear infinite;
                }
            </style>
        </head>
        <body>
            <canvas id="canvas"></canvas>
            
            <div class="controls">
                <button onclick="changeDirectory()">📁 Change Folder</button>
                <button onclick="toggleDirection()" id="dirBtn">↔️ Horizontal</button>
                <button onclick="resetView()">🎯 Reset View</button>
                <button onclick="zoomIn()">🔍 Zoom In</button>
                <button onclick="zoomOut()">🔍 Zoom Out</button>
                <button onclick="toggleConnections()" id="connBtn">🔗 Imports</button>
                <button onclick="expandAll()">⬇️ Expand All</button>
                <button onclick="collapseAll()">⬆️ Collapse All</button>
                <button onclick="toggleTheme()" id="themeBtn">🌙 Dark</button>
                <button onclick="toggleMinimap()" id="minimapBtn">🗺️ Minimap</button>
            </div>
            
            <div class="info">
                <div class="project-name">${projectName}</div>
                <div class="stat">
                    <span class="stat-label">Files:</span>
                    <span class="stat-value" id="fileCount">0</span>
                </div>
                <div class="stat">
                    <span class="stat-label">Folders:</span>
                    <span class="stat-value" id="folderCount">0</span>
                </div>
                <div class="stat">
                    <span class="stat-label">Imports:</span>
                    <span class="stat-value" id="importCount">0</span>
                </div>
                <div class="stat">
                    <span class="stat-label">Zoom:</span>
                    <span class="stat-value" id="zoomLevel">100%</span>
                </div>
            </div>
            
            <div class="search-box">
                <input type="text" id="searchInput" placeholder="Search files..." oninput="handleSearch()" />
                <div class="search-results" id="searchResults"></div>
            </div>
            
            <canvas id="minimap" class="minimap" style="display: none;"></canvas>
            
            <div class="tooltip" id="tooltip"></div>
            <div class="loading" id="loading">Loading project structure...</div>

            <script>
                const vscode = acquireVsCodeApi();
                const canvas = document.getElementById('canvas');
                const ctx = canvas.getContext('2d');
                const minimapCanvas = document.getElementById('minimap');
                const minimapCtx = minimapCanvas.getContext('2d');
                
                let width = canvas.width = window.innerWidth;
                let height = canvas.height = window.innerHeight;
                canvas.onmousemove = (e) => {
            // FIX: Correctly transform screen mouse position to world coordinates
            const mx = (e.clientX - camera.x) / camera.scale;
            const my = (e.clientY - camera.y) / camera.scale;
            
            // Check collision with node boundaries
            hoveredNode = nodes.find(n => 
                mx >= n.x && mx <= n.x + n.width && 
                my >= n.y && my <= n.y + n.height
            );

            if (isDragging) {
                camera.x += e.clientX - lastMouse.x;
                camera.y += e.clientY - lastMouse.y;
            }
            lastMouse = { x: e.clientX, y: e.clientY };
        };
                minimapCanvas.width = 180;
                minimapCanvas.height = 120;
                
                window.addEventListener('resize', () => {
                    width = canvas.width = window.innerWidth;
                    height = canvas.height = window.innerHeight;
                    relayout();
                });
                
                let projectTree = ${JSON.stringify(projectData)};
                
                const colors = {
                    javascript: '#f0db4f',
                    typescript: '#3178c6',
                    react: '#61dafb',
                    vue: '#42b883',
                    python: '#3776ab',
                    java: '#f89820',
                    cpp: '#00599c',
                    csharp: '#68217a',
                    go: '#00add8',
                    rust: '#ce422b',
                    php: '#777bb3',
                    ruby: '#cc342d',
                    swift: '#fa7343',
                    kotlin: '#7f52ff',
                    style: '#264de4',
                    html: '#e34c26',
                    config: '#6a9fb5',
                    markdown: '#083fa1',
                    database: '#336791',
                    folder: '#fbbf24',
                    root: '#ec4899',
                    file: '#9ca3af'
                };
                
                let nodes = [];
                let connections = [];
                let camera = { x: 50, y: 50, scale: 1, targetScale: 1 };
                let isDragging = false;
                let lastMouse = { x: 0, y: 0 };
                let showConnections = false;
                let showMinimap = false;
                let fileCount = 0;
                let folderCount = 0;
                let importCount = 0;
                let nodeMap = new Map();
                let layoutDirection = 'horizontal';
                let hoveredNode = null;
                let selectedNode = null;
                let searchResults = [];
                let theme = 'dark';
                
                // Animation states
                let nodeAnimations = new Map();
                let animationTime = 0;
                
                const NODE_WIDTH = 180;
                const NODE_HEIGHT = 44;
                const H_SPACING = 50;
                const V_SPACING = 70;
                
                function relayout() {
                    document.getElementById('loading').style.display = 'block';
                    
                    setTimeout(() => {
                        nodes = [];
                        connections = [];
                        fileCount = 0;
                        folderCount = 0;
                        importCount = 0;
                        nodeMap.clear();
                        
                        function countNodes(node) {
                            if (!node.children || !node.expanded) return 1;
                            return node.children.reduce((sum, child) => sum + countNodes(child), 0);
                        }
                        
                        function layout(node, x, y, depth = 0) {
                            const nodeObj = {
                                ...node,
                                x, y,
                                width: NODE_WIDTH,
                                height: NODE_HEIGHT,
                                depth,
                                targetX: x,
                                targetY: y,
                                alpha: 0
                            };
                            
                            // Initialize animation
                            if (!nodeAnimations.has(node.id)) {
                                nodeAnimations.set(node.id, {
                                    time: 0,
                                    delay: depth * 50
                                });
                            }
                            
                            nodes.push(nodeObj);
                            nodeMap.set(node.id, nodeObj);
                            
                            if (node.type === 'folder' || node.type === 'root') {
                                folderCount++;
                            } else {
                                fileCount++;
                            }
                            
                            if (node.children && node.children.length > 0 && node.expanded) {
                                if (layoutDirection === 'vertical') {
                                    const nextY = y + NODE_HEIGHT + V_SPACING;
                                    const childCounts = node.children.map(c => countNodes(c));
                                    const totalCount = childCounts.reduce((a, b) => a + b, 0);
                                    const totalWidth = totalCount * (NODE_WIDTH + H_SPACING);
                                    
                                    let currentX = x - totalWidth / 2 + NODE_WIDTH / 2;
                                    
                                    node.children.forEach((child, i) => {
                                        const childWidth = childCounts[i] * (NODE_WIDTH + H_SPACING);
                                        const childX = currentX + childWidth / 2 - NODE_WIDTH / 2;
                                        
                                        const childNode = layout(child, childX, nextY, depth + 1);
                                        connections.push({ from: nodeObj, to: childNode, type: 'hierarchy' });
                                        
                                        currentX += childWidth;
                                    });
                                } else {
                                    const nextX = x + NODE_WIDTH + H_SPACING;
                                    const childCounts = node.children.map(c => countNodes(c));
                                    const totalCount = childCounts.reduce((a, b) => a + b, 0);
                                    const totalHeight = totalCount * (NODE_HEIGHT + V_SPACING);
                                    
                                    let currentY = y - totalHeight / 2 + NODE_HEIGHT / 2;
                                    
                                    node.children.forEach((child, i) => {
                                        const childHeight = childCounts[i] * (NODE_HEIGHT + V_SPACING);
                                        const childY = currentY + childHeight / 2 - NODE_HEIGHT / 2;
                                        
                                        const childNode = layout(child, nextX, childY, depth + 1);
                                        connections.push({ from: nodeObj, to: childNode, type: 'hierarchy' });
                                        
                                        currentY += childHeight;
                                    });
                                }
                            }
                            
                            return nodeObj;
                        }
                        
                        const startX = layoutDirection === 'vertical' ? width / 2 : 150;
                        const startY = layoutDirection === 'vertical' ? 100 : height / 2;
                        layout(projectTree, startX, startY);
                        
                        nodes.forEach(node => {
                            if (node.imports) {
                                node.imports.forEach(importPath => {
                                    const target = Array.from(nodeMap.values()).find(n => n.path === importPath);
                                    if (target && target !== node) {
                                        connections.push({ from: node, to: target, type: 'import' });
                                        importCount++;
                                    }
                                });
                            }
                        });
                        
                        updateStats();
                        document.getElementById('loading').style.display = 'none';
                    }, 10);
                }
                
                function updateStats() {
                    document.getElementById('fileCount').textContent = fileCount;
                    document.getElementById('folderCount').textContent = folderCount;
                    document.getElementById('importCount').textContent = importCount;
                    document.getElementById('zoomLevel').textContent = Math.round(camera.scale * 100) + '%';
                }
                
                relayout();
                
                function screenToWorld(x, y) {
                    return {
                        x: (x - camera.x) / camera.scale,
                        y: (y - camera.y) / camera.scale
                    };
                }
                
                function worldToScreen(x, y) {
                    return {
                        x: x * camera.scale + camera.x,
                        y: y * camera.scale + camera.y
                    };
                }
                
                canvas.addEventListener('mousedown', (e) => {
                    const mouse = screenToWorld(e.clientX, e.clientY);
                    const clicked = nodes.find(n => 
                        mouse.x >= n.x && mouse.x <= n.x + n.width &&
                        mouse.y >= n.y && mouse.y <= n.y + n.height
                    );
                    
                    if (clicked) {
                        selectedNode = clicked;
                        if (clicked.type === 'folder' || clicked.type === 'root') {
                            function findAndToggle(node) {
                                if (node.id === clicked.id) {
                                    node.expanded = !node.expanded;
                                    return true;
                                }
                                if (node.children) {
                                    for (let child of node.children) {
                                        if (findAndToggle(child)) return true;
                                    }
                                }
                                return false;
                            }
                            findAndToggle(projectTree);
                            relayout();
                        } else {
                            vscode.postMessage({ command: 'openFile', file: clicked.path });
                        }
                    } else {
                        isDragging = true;
                        selectedNode = null;
                    }
                    lastMouse = { x: e.clientX, y: e.clientY };
                });
                
                canvas.addEventListener('mousemove', (e) => {
                    if (isDragging) {
                        camera.x += e.clientX - lastMouse.x;
                        camera.y += e.clientY - lastMouse.y;
                    } else {
                        const mouse = screenToWorld(e.clientX, e.clientY);
                        hoveredNode = nodes.find(n => 
                            mouse.x >= n.x && mouse.x <= n.x + n.width &&
                            mouse.y >= n.y && mouse.y <= n.y + n.height
                        );
                        
                        if (hoveredNode) {
                            showTooltip(e.clientX, e.clientY, hoveredNode);
                        } else {
                            hideTooltip();
                        }
                    }
                    lastMouse = { x: e.clientX, y: e.clientY };
                });
                
                canvas.addEventListener('mouseup', () => { isDragging = false; });
                canvas.addEventListener('mouseleave', () => { 
                    isDragging = false;
                    hideTooltip();
                });
                
                canvas.addEventListener('wheel', (e) => {
                    e.preventDefault();
                    const factor = e.deltaY > 0 ? 0.9 : 1.1;
                    const mouse = { x: e.clientX, y: e.clientY };
                    const world = screenToWorld(mouse.x, mouse.y);
                    
                    camera.targetScale = camera.scale * factor;
                    camera.targetScale = Math.max(0.2, Math.min(3, camera.targetScale));
                    
                    const newWorld = screenToWorld(mouse.x, mouse.y);
                    camera.x += (newWorld.x - world.x) * camera.scale;
                    camera.y += (newWorld.y - world.y) * camera.scale;
                });
                
                function showTooltip(x, y, node) {
                    const tooltip = document.getElementById('tooltip');
                    tooltip.style.display = 'block';
                    tooltip.style.left = (x + 15) + 'px';
                    tooltip.style.top = (y + 15) + 'px';

                    let content = \`<strong>\${node.name}</strong><br>\`;
                    content += \`Type: \${node.type}<br>\`;
                    content += \`Path: \${node.path || 'root'}<br>\`;
                    if (node.imports && node.imports.length > 0) {
                        content += \`Imports: \${node.imports.length}\<br>\`;
                    }
                    
                    tooltip.innerHTML = content;
                }
                
                function hideTooltip() {
                    document.getElementById('tooltip').style.display = 'none';
                }
                
                function handleSearch() {
            const query = document.getElementById('searchInput').value.toLowerCase();
            const resDiv = document.getElementById('searchResults');
            resDiv.innerHTML = '';
            
            if (query.length < 2) return;

            // Find matches in your flattened nodes array
            const matches = nodes.filter(n => n.name.toLowerCase().includes(query)).slice(0, 5);
            
            matches.forEach(m => {
                const d = document.createElement('div');
                d.className = 'search-result';
                d.innerText = m.name;
                
                // FIX: Directly referencing the node object 'm' instead of string interpolation
                d.onclick = () => {
                    // Center the camera on the node with smooth transition
                    camera.x = (width / 2) - (m.x * camera.scale);
                    camera.y = (height / 2) - (m.y * camera.scale);
                    hoveredNode = m; // Highlight the found node
                };
                resDiv.appendChild(d);
            });
        }
                
                function focusNode(nodeId) {
                    const node = nodeMap.get(nodeId);
                    if (node) {
                        selectedNode = node;
                        camera.x = width / 2 - node.x * camera.scale - node.width * camera.scale / 2;
                        camera.y = height / 2 - node.y * camera.scale - node.height * camera.scale / 2;
                    }
                }
                
                function draw() {
                    animationTime += 16;
                    
                    // Smooth camera zoom
                    camera.scale += (camera.targetScale - camera.scale) * 0.1;
                    updateStats();
                    
                    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--bg-primary');
                    ctx.fillRect(0, 0, width, height);
                    
                    ctx.save();
                    ctx.translate(camera.x, camera.y);
                    ctx.scale(camera.scale, camera.scale);
                    
                    // Draw animated grid
                    const gridColor = getComputedStyle(document.body).getPropertyValue('--grid-color');
                    ctx.strokeStyle = gridColor;
                    ctx.lineWidth = 1 / camera.scale;
                    const gridSize = 40;
                    const startX = Math.floor(-camera.x / camera.scale / gridSize) * gridSize;
                    const startY = Math.floor(-camera.y / camera.scale / gridSize) * gridSize;
                    const endX = startX + (width / camera.scale) + gridSize * 2;
                    const endY = startY + (height / camera.scale) + gridSize * 2;
                    
                    ctx.globalAlpha = 0.3;
                    for (let x = startX; x < endX; x += gridSize) {
                        ctx.beginPath();
                        ctx.moveTo(x, startY);
                        ctx.lineTo(x, endY);
                        ctx.stroke();
                    }
                    for (let y = startY; y < endY; y += gridSize) {
                        ctx.beginPath();
                        ctx.moveTo(startX, y);
                        ctx.lineTo(endX, y);
                        ctx.stroke();
                    }
                    ctx.globalAlpha = 1;
                    
                    // Draw connections
                    const connColor = getComputedStyle(document.body).getPropertyValue('--connection-color');
                    const importColor = getComputedStyle(document.body).getPropertyValue('--import-color');
                    
                    connections.forEach(conn => {
                        if (conn.type === 'import' && !showConnections) return;
                        
                        // Animate connections
                        const pulseAlpha = conn.type === 'import' ? 
                            0.4 + Math.sin(animationTime * 0.003) * 0.2 : 1;
                        
                        ctx.strokeStyle = conn.type === 'hierarchy' ? connColor : importColor;
                        ctx.lineWidth = (conn.type === 'hierarchy' ? 2 : 1.5) / camera.scale;
                        ctx.globalAlpha = pulseAlpha;
                        
                        if (conn.type === 'import') {
                            ctx.setLineDash([5 / camera.scale, 5 / camera.scale]);
                        }
                        
                        ctx.beginPath();
                        
                        if (layoutDirection === 'vertical') {
                            const fromX = conn.from.x + conn.from.width / 2;
                            const fromY = conn.from.y + conn.from.height;
                            const toX = conn.to.x + conn.to.width / 2;
                            const toY = conn.to.y;
                            const midY = (fromY + toY) / 2;
                            
                            ctx.moveTo(fromX, fromY);
                            ctx.bezierCurveTo(fromX, midY, toX, midY, toX, toY);
                        } else {
                            const fromX = conn.from.x + conn.from.width;
                            const fromY = conn.from.y + conn.from.height / 2;
                            const toX = conn.to.x;
                            const toY = conn.to.y + conn.to.height / 2;
                            const midX = (fromX + toX) / 2;
                            
                            ctx.moveTo(fromX, fromY);
                            ctx.bezierCurveTo(midX, fromY, midX, toY, toX, toY);
                        }
                        
                        ctx.stroke();
                        ctx.setLineDash([]);
                        ctx.globalAlpha = 1;
                        
                        // Draw arrow for imports
                        if (conn.type === 'import' && showConnections) {
                            const toX = layoutDirection === 'vertical' ? 
                                conn.to.x + conn.to.width / 2 : conn.to.x;
                            const toY = layoutDirection === 'vertical' ? 
                                conn.to.y : conn.to.y + conn.to.height / 2;
                            
                            ctx.fillStyle = importColor;
                            ctx.globalAlpha = pulseAlpha;
                            ctx.beginPath();
                            
                            if (layoutDirection === 'vertical') {
                                ctx.moveTo(toX, toY);
                                ctx.lineTo(toX - 4 / camera.scale, toY - 8 / camera.scale);
                                ctx.lineTo(toX + 4 / camera.scale, toY - 8 / camera.scale);
                            } else {
                                ctx.moveTo(toX, toY);
                                ctx.lineTo(toX - 8 / camera.scale, toY - 4 / camera.scale);
                                ctx.lineTo(toX - 8 / camera.scale, toY + 4 / camera.scale);
                            }
                            
                            ctx.fill();
                            ctx.globalAlpha = 1;
                        }
                    });
                    
                    // Update and draw nodes with animations
                    nodes.forEach(n => {
                        const anim = nodeAnimations.get(n.id);
                        if (anim) {
                            anim.time = Math.min(anim.time + 16, 500);
                            const progress = Math.max(0, (anim.time - anim.delay) / 300);
                            n.alpha = Math.min(1, progress);
                            
                            // Ease in animation
                            const easeProgress = 1 - Math.pow(1 - progress, 3);
                            n.x = n.targetX;
                            n.y = n.targetY + (1 - easeProgress) * 20;
                        }
                        
                        if (n.alpha <= 0) return;
                        
                        const color = colors[n.type] || colors.file;
                        const isHovered = hoveredNode === n;
                        const isSelected = selectedNode === n;
                        
                        ctx.globalAlpha = n.alpha;
                        
                        // Shadow for hovered/selected
                        if (isHovered || isSelected) {
                            ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
                            ctx.shadowBlur = 10 / camera.scale;
                            ctx.shadowOffsetY = 4 / camera.scale;
                        }
                        
                        // Node body
                        const bgColor = getComputedStyle(document.body).getPropertyValue('--bg-secondary');
                        ctx.fillStyle = bgColor;
                        const radius = 6 / camera.scale;
                        ctx.beginPath();
                        ctx.roundRect(n.x, n.y, n.width, n.height, radius);
                        ctx.fill();
                        
                        // Selected highlight
                        if (isSelected) {
                            const accentColor = getComputedStyle(document.body).getPropertyValue('--accent');
                            ctx.strokeStyle = accentColor;
                            ctx.lineWidth = 3 / camera.scale;
                            ctx.stroke();
                        }
                        
                        ctx.shadowColor = 'transparent';
                        ctx.shadowBlur = 0;
                        
                        // Left accent bar
                        ctx.fillStyle = color;
                        ctx.fillRect(n.x, n.y, 5 / camera.scale, n.height);
                        
                        // Border
                        const borderColor = getComputedStyle(document.body).getPropertyValue('--border-color');
                        ctx.strokeStyle = borderColor;
                        ctx.lineWidth = 1 / camera.scale;
                        ctx.beginPath();
                        ctx.roundRect(n.x, n.y, n.width, n.height, radius);
                        ctx.stroke();
                        
                        // Icon circle
                        const iconX = n.x + 20 / camera.scale;
                        const iconY = n.y + n.height / 2;
                        const iconRadius = 12 / camera.scale;
                        
                        ctx.fillStyle = color + '20';
                        ctx.beginPath();
                        ctx.arc(iconX, iconY, iconRadius, 0, Math.PI * 2);
                        ctx.fill();
                        
                        ctx.fillStyle = color;
                        ctx.font = \`\${10 / camera.scale}px Segoe UI\`;
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        
                        const icon = n.type === 'folder' || n.type === 'root' ? '📁' : 
                                    n.type === 'javascript' ? 'JS' :
                                    n.type === 'typescript' ? 'TS' :
                                    n.type === 'react' ? 'RX' :
                                    n.type === 'python' ? 'PY' :
                                    n.type === 'style' ? 'CSS' : '📄';
                        
                        ctx.fillText(icon, iconX, iconY);
                        
                        // Text
                        const textColor = getComputedStyle(document.body).getPropertyValue('--text-primary');
                        ctx.fillStyle = textColor;
                        ctx.font = \`\${11 / camera.scale}px Segoe UI\`;
                        ctx.textAlign = 'left';
                        ctx.textBaseline = 'middle';
                        
                        const maxTextWidth = n.width - 50 / camera.scale;
                        let text = n.name;
                        const textWidth = ctx.measureText(text).width;
                        
                        if (textWidth > maxTextWidth) {
                            while (ctx.measureText(text + '...').width > maxTextWidth && text.length > 0) {
                                text = text.slice(0, -1);
                            }
                            text += '...';
                        }
                        
                        ctx.fillText(text, n.x + 35 / camera.scale, n.y + n.height / 2);
                        
                        // Collapse indicator
                        if ((n.type === 'folder' || n.type === 'root') && n.children && n.children.length > 0) {
                            const secondaryColor = getComputedStyle(document.body).getPropertyValue('--text-secondary');
                            ctx.fillStyle = secondaryColor;
                            ctx.font = \`\${9 / camera.scale}px Segoe UI\`;
                            ctx.textAlign = 'right';
                            ctx.fillText(n.expanded ? '▼' : '▶', n.x + n.width - 8 / camera.scale, n.y + n.height / 2);
                        }
                        
                        // Badge for file count
                        if (n.type === 'folder' && n.children) {
                            const count = n.children.length;
                            ctx.fillStyle = color;
                            ctx.font = \`\${8 / camera.scale}px Segoe UI\`;
                            ctx.textAlign = 'right';
                            ctx.fillText(count.toString(), n.x + n.width - 20 / camera.scale, n.y + n.height / 2);
                        }
                        
                        ctx.globalAlpha = 1;
                    });
                    
                    ctx.restore();
                    
                    // Draw minimap
                    if (showMinimap) {
                        drawMinimap();
                    }
                }
                
                function drawMinimap() {
                    const mmW = minimapCanvas.width;
                    const mmH = minimapCanvas.height;
                    
                    minimapCtx.fillStyle = getComputedStyle(document.body).getPropertyValue('--bg-tertiary');
                    minimapCtx.fillRect(0, 0, mmW, mmH);
                    
                    if (nodes.length === 0) return;
                    
                    // Calculate bounds
                    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                    nodes.forEach(n => {
                        minX = Math.min(minX, n.x);
                        minY = Math.min(minY, n.y);
                        maxX = Math.max(maxX, n.x + n.width);
                        maxY = Math.max(maxY, n.y + n.height);
                    });
                    
                    const worldW = maxX - minX;
                    const worldH = maxY - minY;
                    const scale = Math.min(mmW / worldW, mmH / worldH) * 0.9;
                    const offsetX = (mmW - worldW * scale) / 2 - minX * scale;
                    const offsetY = (mmH - worldH * scale) / 2 - minY * scale;
                    
                    // Draw nodes
                    nodes.forEach(n => {
                        const x = n.x * scale + offsetX;
                        const y = n.y * scale + offsetY;
                        const w = n.width * scale;
                        const h = n.height * scale;
                        
                        const color = colors[n.type] || colors.file;
                        minimapCtx.fillStyle = color;
                        minimapCtx.fillRect(x, y, Math.max(2, w), Math.max(2, h));
                    });
                    
                    // Draw viewport
                    const vpX = (-camera.x / camera.scale) * scale + offsetX;
                    const vpY = (-camera.y / camera.scale) * scale + offsetY;
                    const vpW = (width / camera.scale) * scale;
                    const vpH = (height / camera.scale) * scale;
                    
                    const accentColor = getComputedStyle(document.body).getPropertyValue('--accent');
                    minimapCtx.strokeStyle = accentColor;
                    minimapCtx.lineWidth = 2;
                    minimapCtx.strokeRect(vpX, vpY, vpW, vpH);
                }
                
                function animate() {
                    draw();
                    requestAnimationFrame(animate);
                }
                
                function resetView() {
                    camera = { x: 50, y: 50, scale: 1, targetScale: 1 };
                }
                
                function zoomIn() {
                    camera.targetScale = Math.min(3, camera.targetScale * 1.3);
                }
                
                function zoomOut() {
                    camera.targetScale = Math.max(0.2, camera.targetScale * 0.7);
                }
                
                function toggleConnections() {
                    showConnections = !showConnections;
                    const btn = document.getElementById('connBtn');
                    btn.classList.toggle('active', showConnections);
                    btn.textContent = showConnections ? '🔗 Imports ✓' : '🔗 Imports';
                }
                
                function toggleMinimap() {
                    showMinimap = !showMinimap;
                    minimapCanvas.style.display = showMinimap ? 'block' : 'none';
                    const btn = document.getElementById('minimapBtn');
                    btn.classList.toggle('active', showMinimap);
                    btn.textContent = showMinimap ? '🗺️ Minimap ✓' : '🗺️ Minimap';
                }
                
                function toggleTheme() {
                    theme = theme === 'dark' ? 'light' : 'dark';
                    document.body.classList.toggle('light-theme', theme === 'light');
                    const btn = document.getElementById('themeBtn');
                    btn.textContent = theme === 'dark' ? '🌙 Dark' : '☀️ Light';
                }
                
                function toggleNodeRecursive(node, expand) {
                    if (node.type === 'folder' || node.type === 'root') {
                        node.expanded = expand;
                    }
                    if (node.children) {
                        node.children.forEach(child => toggleNodeRecursive(child, expand));
                    }
                }
                
                function expandAll() {
                    toggleNodeRecursive(projectTree, true);
                    relayout();
                }
                
                function collapseAll() {
                    toggleNodeRecursive(projectTree, false);
                    projectTree.expanded = true;
                    relayout();
                }
                
                function changeDirectory() {
                    vscode.postMessage({ command: 'changeDirectory' });
                }
                
                function toggleDirection() {
                    layoutDirection = layoutDirection === 'vertical' ? 'horizontal' : 'vertical';
                    camera = { x: 50, y: 50, scale: 1, targetScale: 1 };
                    const btn = document.getElementById('dirBtn');
                    btn.textContent = layoutDirection === 'vertical' ? '↕️ Vertical' : '↔️ Horizontal';
                    relayout();
                }
                
                animate();
            </script>
        </body>
        </html>`;
}

module.exports = { activate };