// extension.js - Blueprint-style Project Visualizer
const vscode = require('vscode');
const path = require('path');
const fs = require('fs');

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
        if (depth > 2) return; // Limit to 2 levels for cleaner view
        
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
                        expanded: true,
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
                        } catch (e) {}
                        
                        node.children.push(fileNode);
                    }
                }
            }
        } catch (e) {}
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
        body {
            overflow: hidden;
            background: #1e1e1e;
            font-family: 'Segoe UI', system-ui, sans-serif;
            color: #fff;
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
            top: 10px;
            left: 10px;
            display: flex;
            gap: 5px;
            z-index: 100;
        }
        .controls button {
            padding: 8px 14px;
            background: #2d2d30;
            color: #ccc;
            border: 1px solid #3e3e42;
            border-radius: 3px;
            cursor: pointer;
            font-size: 11px;
            transition: all 0.15s;
        }
        .controls button:hover {
            background: #3e3e42;
            color: #fff;
        }
        
        .info {
            position: absolute;
            top: 10px;
            right: 10px;
            background: #2d2d30;
            padding: 10px 14px;
            border-radius: 3px;
            border: 1px solid #3e3e42;
            font-size: 11px;
            z-index: 100;
            color: #ccc;
        }
        .info div { margin: 3px 0; }
    </style>
</head>
<body>
    <canvas id="canvas"></canvas>
    
    <div class="controls">
        <button onclick="changeDirectory()">Change Folder</button>
        <button onclick="toggleDirection()">Direction</button>
        <button onclick="resetView()">Reset</button>
        <button onclick="zoomIn()">+</button>
        <button onclick="zoomOut()">-</button>
        <button onclick="toggleConnections()">Imports</button>
        <button onclick="expandAll()">Expand</button>
        <button onclick="collapseAll()">Collapse</button>
    </div>
    
    <div class="info">
        <div>${projectName}</div>
        <div>Files: <span id="fileCount">0</span> | Folders: <span id="folderCount">0</span></div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const canvas = document.getElementById('canvas');
        const ctx = canvas.getContext('2d');
        
        let width = canvas.width = window.innerWidth;
        let height = canvas.height = window.innerHeight;
        
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
        let camera = { x: 50, y: 50, scale: 1 };
        let isDragging = false;
        let lastMouse = { x: 0, y: 0 };
        let showConnections = false;
        let fileCount = 0;
        let folderCount = 0;
        let nodeMap = new Map();
        let layoutDirection = 'vertical';
        
        const NODE_WIDTH = 160;
        const NODE_HEIGHT = 40;
        const H_SPACING = 40;
        const V_SPACING = 60;
        
        function relayout() {
            nodes = [];
            connections = [];
            fileCount = 0;
            folderCount = 0;
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
                    depth
                };
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
                        }
                    });
                }
            });
            
            document.getElementById('fileCount').textContent = fileCount;
            document.getElementById('folderCount').textContent = folderCount;
        }
        
        relayout();
        
        function screenToWorld(x, y) {
            return {
                x: (x - camera.x) / camera.scale,
                y: (y - camera.y) / camera.scale
            };
        }
        
        canvas.addEventListener('mousedown', (e) => {
            const mouse = screenToWorld(e.clientX, e.clientY);
            const clicked = nodes.find(n => 
                mouse.x >= n.x && mouse.x <= n.x + n.width &&
                mouse.y >= n.y && mouse.y <= n.y + n.height
            );
            
            if (clicked) {
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
            }
            lastMouse = { x: e.clientX, y: e.clientY };
        });
        
        canvas.addEventListener('mousemove', (e) => {
            if (isDragging) {
                camera.x += e.clientX - lastMouse.x;
                camera.y += e.clientY - lastMouse.y;
            }
            lastMouse = { x: e.clientX, y: e.clientY };
        });
        
        canvas.addEventListener('mouseup', () => { isDragging = false; });
        
        canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const factor = e.deltaY > 0 ? 0.9 : 1.1;
            const mouse = { x: e.clientX, y: e.clientY };
            const world = screenToWorld(mouse.x, mouse.y);
            
            camera.scale *= factor;
            camera.scale = Math.max(0.3, Math.min(2, camera.scale));
            
            const newWorld = screenToWorld(mouse.x, mouse.y);
            camera.x += (newWorld.x - world.x) * camera.scale;
            camera.y += (newWorld.y - world.y) * camera.scale;
        });
        
        function draw() {
            ctx.fillStyle = '#1e1e1e';
            ctx.fillRect(0, 0, width, height);
            
            ctx.save();
            ctx.translate(camera.x, camera.y);
            ctx.scale(camera.scale, camera.scale);
            
            // Draw grid
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
            ctx.lineWidth = 1;
            const gridSize = 20;
            const startX = Math.floor(-camera.x / camera.scale / gridSize) * gridSize;
            const startY = Math.floor(-camera.y / camera.scale / gridSize) * gridSize;
            const endX = startX + (width / camera.scale) + gridSize;
            const endY = startY + (height / camera.scale) + gridSize;
            
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
            
            // Draw connections
            connections.forEach(conn => {
                if (conn.type === 'import' && !showConnections) return;
                
                ctx.strokeStyle = conn.type === 'hierarchy' 
                    ? 'rgba(255, 255, 255, 0.15)' 
                    : 'rgba(100, 200, 255, 0.3)';
                ctx.lineWidth = conn.type === 'hierarchy' ? 1.5 : 1;
                if (conn.type === 'import') ctx.setLineDash([3, 3]);
                
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
            });
            
            // Draw nodes
            nodes.forEach(n => {
                const color = colors[n.type] || colors.file;
                
                // Node body
                ctx.fillStyle = '#252526';
                ctx.fillRect(n.x, n.y, n.width, n.height);
                
                // Left accent
                ctx.fillStyle = color;
                ctx.fillRect(n.x, n.y, 4, n.height);
                
                // Border
                ctx.strokeStyle = '#3e3e42';
                ctx.lineWidth = 1;
                ctx.strokeRect(n.x, n.y, n.width, n.height);
                
                // Text
                ctx.fillStyle = '#cccccc';
                ctx.font = '11px Segoe UI';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                const text = n.name.length > 20 ? n.name.substring(0, 17) + '...' : n.name;
                ctx.fillText(text, n.x + 10, n.y + n.height / 2);
                
                // Collapse indicator
                if ((n.type === 'folder' || n.type === 'root') && n.children && n.children.length > 0) {
                    ctx.fillStyle = '#888';
                    ctx.font = '9px Segoe UI';
                    ctx.textAlign = 'right';
                    ctx.fillText(n.expanded ? '▼' : '▶', n.x + n.width - 6, n.y + n.height / 2);
                }
            });
            
            ctx.restore();
        }
        
        function animate() {
            draw();
            requestAnimationFrame(animate);
        }
        
        function resetView() {
            camera = { x: 50, y: 50, scale: 1 };
        }
        
        function zoomIn() {
            camera.scale *= 1.2;
            camera.scale = Math.min(2, camera.scale);
        }
        
        function zoomOut() {
            camera.scale *= 0.8;
            camera.scale = Math.max(0.3, camera.scale);
        }
        
        function toggleConnections() {
            showConnections = !showConnections;
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
            camera = { x: 50, y: 50, scale: 1 };
            relayout();
        }
        
        animate();
    </script>
</body>
</html>`;
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
};