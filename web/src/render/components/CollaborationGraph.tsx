import { useEffect, useRef } from 'react';
import cytoscape from 'cytoscape';
import { usePreview } from '../markdown';

// Grafo de colaboração (Cytoscape.js) — espelho React do componente Svelte
// customizado do Evidence (evidence-components/CollaborationGraph.svelte).
// Props (iguais às do .svelte, vindas do markdown):
//   nodes / edges     -> nomes das queries no dataMap
//   focusNodeId       -> id do nó central (destacado)
//   nodeLabel         -> coluna com o rótulo do nó
//   nodeWeight        -> coluna que dimensiona o nó
//   nodeColorBy       -> coluna categórica que define a cor
//   edgeWeight        -> coluna que dá a espessura da aresta
//   layout            -> "force-directed" (cose) | "concentric" | "circle" | "grid"
//   linkBase          -> prefixo de navegação no clique (default /instituicao/)
export default function CollaborationGraph(props: any) {
  const { dataMap, errors, settings, onLink } = usePreview();
  const el = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);

  const nodesQ = props.nodes || 'nodes';
  const edgesQ = props.edges || 'edges';
  const err = errors[nodesQ] || errors[edgesQ];
  const nodeRows = dataMap[nodesQ] || [];
  const edgeRows = dataMap[edgesQ] || [];

  const idCol = props.nodeId || 'institution_id';
  const labelCol = props.nodeLabel || 'institution_name';
  const weightCol = props.nodeWeight;
  const colorCol = props.nodeColorBy;
  const ewCol = props.edgeWeight;
  const focus = props.focusNodeId;
  const linkBase = props.linkBase ?? '/instituicao/';
  const dark = settings?.theme?.mode === 'dark';
  const palette: string[] = settings?.theme?.chartPalette || ['#236aa4', '#45a1bf', '#7b61ff', '#16a34a', '#f59e0b'];

  useEffect(() => {
    if (!el.current || err) return;
    if (nodeRows.length === 0) return;

    // nós: ids únicos das linhas de nodes + garante o nó-foco e pontas das arestas
    const seen = new Set<string>();
    const cyNodes: any[] = [];
    const addNode = (id: string, row: any) => {
      if (!id || seen.has(id)) return;
      seen.add(id);
      cyNodes.push({ data: { id, label: row?.[labelCol] ?? id, w: Number(row?.[weightCol]) || 1, g: String(row?.[colorCol] ?? '') } });
    };
    for (const r of nodeRows) addNode(String(r[idCol]), r);
    if (focus) addNode(String(focus), { [labelCol]: String(focus) });
    const cyEdges: any[] = [];
    for (const r of edgeRows) {
      const s = String(r.source_id ?? r.inst_a ?? focus ?? '');
      const t = String(r.target_id ?? r.inst_b ?? '');
      if (!s || !t) continue;
      addNode(s, null);
      addNode(t, { [labelCol]: r.target_name });
      cyEdges.push({ data: { source: s, target: t, w: Number(r[ewCol]) || 1, ...r } });
    }

    const maxW = Math.max(1, ...cyNodes.map((n) => n.data.w));
    const maxE = Math.max(1e-9, ...cyEdges.map((e) => e.data.w));
    const groups = [...new Set(cyNodes.map((n) => n.data.g))];
    const colorOf = (g: string) => palette[Math.max(0, groups.indexOf(g)) % palette.length];

    const cy = cytoscape({
      container: el.current,
      elements: [...cyNodes, ...cyEdges],
      style: [
        {
          selector: 'node',
          style: {
            label: 'data(label)',
            'font-size': 9,
            color: dark ? '#cfd3dc' : '#374151',
            'text-valign': 'bottom',
            'text-margin-y': 4,
            'text-max-width': '110px',
            'text-wrap': 'ellipsis',
            width: (n: any) => 12 + 30 * Math.sqrt(n.data('w') / maxW),
            height: (n: any) => 12 + 30 * Math.sqrt(n.data('w') / maxW),
            'background-color': (n: any) => colorOf(n.data('g')),
            'border-width': (n: any) => (n.id() === String(focus) ? 4 : 1),
            'border-color': (n: any) => (n.id() === String(focus) ? '#dc2626' : dark ? '#374151' : '#e5e7eb'),
          },
        },
        {
          selector: 'edge',
          style: {
            width: (e: any) => 1 + 5 * (e.data('w') / maxE),
            'line-color': dark ? '#3b4455' : '#cbd5e1',
            'curve-style': 'bezier',
            opacity: 0.7,
          },
        },
      ],
      layout:
        props.layout === 'concentric'
          ? { name: 'concentric', concentric: (n: any) => (n.id() === String(focus) ? 2 : 1), levelWidth: () => 1 }
          : props.layout === 'circle'
            ? { name: 'circle' }
            : props.layout === 'grid'
              ? { name: 'grid' }
              : { name: 'cose', animate: false, nodeRepulsion: () => 90000, idealEdgeLength: () => 90 },
      wheelSensitivity: 0.2,
    });

    (window as any).__cy = cy; // handle de debug (dev)

    // O container pode estar com tamanho zero no primeiro mount (layout do editor
    // ainda assentando) — refaz o fit no frame seguinte para não nascer em branco.
    requestAnimationFrame(() => {
      cy.resize();
      cy.fit(undefined, 30);
    });

    // tooltip simples no hover
    cy.on('mouseover', 'node', (ev) => {
      const tip = tipRef.current;
      if (!tip) return;
      const d = ev.target.data();
      tip.textContent = `${d.label}${d.g ? ' · ' + d.g : ''}${weightCol ? ' · ' + weightCol + ': ' + Number(d.w).toLocaleString('pt-BR') : ''}`;
      tip.style.display = 'block';
      const p = ev.target.renderedPosition();
      tip.style.left = p.x + 12 + 'px';
      tip.style.top = p.y - 8 + 'px';
    });
    cy.on('mouseout', 'node', () => {
      if (tipRef.current) tipRef.current.style.display = 'none';
    });
    // clique -> drill-down (rota Evidence)
    cy.on('tap', 'node', (ev) => {
      if (onLink && linkBase) onLink(linkBase + ev.target.id() + '/');
    });

    return () => cy.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(nodeRows), JSON.stringify(edgeRows), focus, dark, err]);

  if (err) return <div className="error">{err}</div>;
  if (nodeRows.length === 0) return <div className="muted">Sem dados para o grafo.</div>;
  return (
    <div className="collab-graph">
      <div ref={el} style={{ width: '100%', height: 460 }} />
      <div ref={tipRef} className="collab-tip" />
    </div>
  );
}
