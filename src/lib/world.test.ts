import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyDoc, applyCommand, invertCommand,
  buildAddNode, buildDeleteNodes, buildMoveNodes, buildResizeNode, buildPatchNode,
  buildAddEdge, buildDeleteEdge, buildPatchEdge, buildCreateGroup, nodesInGroup,
  nodeBounds, hitTestNode, edgeAnchor, pointInPolygon, nodesInLasso, nodesAlongStroke, buildLinkLassoEdges,
  toJsonCanvas, fromJsonCanvas, slugify, uniqueSlug,
  colorHex, edgeColor, rectFromPoints, nodesInRect, segmentsIntersect, edgeCutByStroke,
  linkedNodeIds, nextImportOrigin, layoutImportColumn, layoutImportCross, fitMediaSize,
  childrenOf, groupAt, buildAttachToGroup, buildDetachChildren, captionFontSize, sizeNodeToRect, angleBetween,
  noteIdOf, fisheyeScale, buildWorkspaceImport, rotatePoint, WORLD_PALETTE, worldCardTags,
  TextNode, NoteNode, MediaNode, GroupNode, WorldDoc, WorldEdge, WorkspaceSnapshot, ImportScope,
} from './world';

const textNode = (id: string, x = 0, y = 0, w = 100, h = 50, text = 'hi'): TextNode =>
  ({ id, type: 'text', x, y, width: w, height: h, text });

test('buildAddNode + applyCommand adds a node', () => {
  const doc = emptyDoc();
  const node = textNode('a');
  const cmd = buildAddNode(node);
  const next = applyCommand(doc, cmd);
  assert.equal(next.nodes.length, 1);
  assert.equal(next.nodes[0].id, 'a');
});

test('add -> invert -> apply removes the node again', () => {
  const doc = emptyDoc();
  const cmd = buildAddNode(textNode('a'));
  const added = applyCommand(doc, cmd);
  const undone = applyCommand(added, invertCommand(cmd));
  assert.deepEqual(undone, doc);
});

test('buildDeleteNodes also drops incident edges, and invert restores both', () => {
  let doc: WorldDoc = emptyDoc();
  doc = applyCommand(doc, buildAddNode(textNode('a')));
  doc = applyCommand(doc, buildAddNode(textNode('b')));
  const edgeCmd = buildAddEdge(doc, 'a', 'b');
  assert.ok(edgeCmd);
  doc = applyCommand(doc, edgeCmd!);
  assert.equal(doc.edges.length, 1);

  const delCmd = buildDeleteNodes(doc, ['a']);
  assert.ok(delCmd);
  const afterDelete = applyCommand(doc, delCmd!);
  assert.equal(afterDelete.nodes.length, 1);
  assert.equal(afterDelete.edges.length, 0);

  const restored = applyCommand(afterDelete, invertCommand(delCmd!));
  assert.equal(restored.nodes.length, 2);
  assert.equal(restored.edges.length, 1);
});

test('buildDeleteNodes returns null for ids not present', () => {
  const doc = emptyDoc();
  assert.equal(buildDeleteNodes(doc, ['missing']), null);
});

test('buildDetachChildren clears every parentId as one batch, and invert restores membership', () => {
  let doc: WorldDoc = emptyDoc();
  const groupCmd = buildCreateGroup({ x: 0, y: 0, width: 500, height: 400 }, 'G');
  doc = applyCommand(doc, groupCmd);
  const groupId = (groupCmd as Extract<typeof groupCmd, { type: 'add' }>).nodes[0].id;
  doc = applyCommand(doc, buildAddNode({ ...textNode('a', 10, 60), parentId: groupId }));
  doc = applyCommand(doc, buildAddNode({ ...textNode('b', 10, 120), parentId: groupId }));
  doc = applyCommand(doc, buildAddNode(textNode('c', 900, 900))); // outsider, untouched

  const cmd = buildDetachChildren(doc, groupId);
  assert.ok(cmd);
  const detached = applyCommand(doc, cmd!);
  assert.equal(childrenOf(detached, groupId).length, 0);
  // Positions untouched — detach only severs membership.
  const a = detached.nodes.find((n) => n.id === 'a')!;
  assert.equal(a.x, 10); assert.equal(a.y, 60);
  assert.equal('parentId' in a, false);

  const restored = applyCommand(detached, invertCommand(cmd!));
  assert.deepEqual(restored, doc);
});

test('buildDetachChildren returns null for an empty group', () => {
  let doc: WorldDoc = emptyDoc();
  const groupCmd = buildCreateGroup({ x: 0, y: 0, width: 100, height: 100 });
  doc = applyCommand(doc, groupCmd);
  const groupId = (groupCmd as Extract<typeof groupCmd, { type: 'add' }>).nodes[0].id;
  assert.equal(buildDetachChildren(doc, groupId), null);
});

test('move command shifts positions and inverts cleanly', () => {
  let doc: WorldDoc = emptyDoc();
  doc = applyCommand(doc, buildAddNode(textNode('a', 10, 10)));
  const cmd = buildMoveNodes(['a'], 5, -3);
  assert.ok(cmd);
  const moved = applyCommand(doc, cmd!);
  assert.equal(moved.nodes[0].x, 15);
  assert.equal(moved.nodes[0].y, 7);
  const back = applyCommand(moved, invertCommand(cmd!));
  assert.deepEqual(back, doc);
});

test('buildMoveNodes is a no-op for zero delta or empty ids', () => {
  assert.equal(buildMoveNodes([], 5, 5), null);
  assert.equal(buildMoveNodes(['a'], 0, 0), null);
});

test('resize command updates width/height and inverts', () => {
  let doc: WorldDoc = emptyDoc();
  doc = applyCommand(doc, buildAddNode(textNode('a', 0, 0, 100, 50)));
  const cmd = buildResizeNode(doc, 'a', 200, 80);
  assert.ok(cmd);
  const resized = applyCommand(doc, cmd!);
  assert.equal(resized.nodes[0].width, 200);
  assert.equal(resized.nodes[0].height, 80);
  const back = applyCommand(resized, invertCommand(cmd!));
  assert.deepEqual(back, doc);
});

test('patch command updates arbitrary fields (e.g. text/subtext) and inverts', () => {
  let doc: WorldDoc = emptyDoc();
  doc = applyCommand(doc, buildAddNode(textNode('a')));
  const cmd = buildPatchNode(doc, 'a', { text: 'updated', subtext: 'note' });
  assert.ok(cmd);
  const patched = applyCommand(doc, cmd!);
  assert.equal((patched.nodes[0] as TextNode).text, 'updated');
  assert.equal((patched.nodes[0] as TextNode).subtext, 'note');
  const back = applyCommand(patched, invertCommand(cmd!));
  assert.deepEqual(back, doc);
});

test('buildAddEdge rejects self-edges', () => {
  const doc = emptyDoc();
  assert.equal(buildAddEdge(doc, 'a', 'a'), null);
});

test('buildAddEdge rejects a duplicate in either direction', () => {
  let doc: WorldDoc = emptyDoc();
  doc = applyCommand(doc, buildAddNode(textNode('a')));
  doc = applyCommand(doc, buildAddNode(textNode('b')));
  const first = buildAddEdge(doc, 'a', 'b');
  assert.ok(first);
  doc = applyCommand(doc, first!);
  assert.equal(buildAddEdge(doc, 'a', 'b'), null);
  assert.equal(buildAddEdge(doc, 'b', 'a'), null);
});

test('deleteEdge / patchEdge invert cleanly', () => {
  let doc: WorldDoc = emptyDoc();
  doc = applyCommand(doc, buildAddNode(textNode('a')));
  doc = applyCommand(doc, buildAddNode(textNode('b')));
  const addEdge = buildAddEdge(doc, 'a', 'b', { label: 'relates to' });
  doc = applyCommand(doc, addEdge!);
  const edgeId = doc.edges[0].id;

  const patchCmd = buildPatchEdge(doc, edgeId, { label: 'depends on' });
  assert.ok(patchCmd);
  const patched = applyCommand(doc, patchCmd!);
  assert.equal(patched.edges[0].label, 'depends on');
  const unpatched = applyCommand(patched, invertCommand(patchCmd!));
  assert.deepEqual(unpatched, doc);

  const delCmd = buildDeleteEdge(doc, edgeId);
  assert.ok(delCmd);
  const deleted = applyCommand(doc, delCmd!);
  assert.equal(deleted.edges.length, 0);
  const restored = applyCommand(deleted, invertCommand(delCmd!));
  assert.deepEqual(restored, doc);
});

test('nodesInGroup returns only contained non-group nodes', () => {
  let doc: WorldDoc = emptyDoc();
  const group = buildCreateGroup({ x: 0, y: 0, width: 300, height: 300 }, 'My Group');
  doc = applyCommand(doc, group);
  const groupId = (doc.nodes[0] as GroupNode).id;
  doc = applyCommand(doc, buildAddNode(textNode('inside', 10, 10, 50, 50)));
  doc = applyCommand(doc, buildAddNode(textNode('outside', 1000, 1000, 50, 50)));
  const members = nodesInGroup(doc, groupId);
  assert.equal(members.length, 1);
  assert.equal(members[0].id, 'inside');
});

test('nodeBounds computes the bounding box of all nodes', () => {
  let doc: WorldDoc = emptyDoc();
  doc = applyCommand(doc, buildAddNode(textNode('a', 0, 0, 100, 100)));
  doc = applyCommand(doc, buildAddNode(textNode('b', 200, 300, 50, 50)));
  const bounds = nodeBounds(doc);
  assert.deepEqual(bounds, { x: 0, y: 0, width: 250, height: 350 });
});

test('nodeBounds is null for an empty doc', () => {
  assert.equal(nodeBounds(emptyDoc()), null);
});

test('hitTestNode finds the topmost node under a point', () => {
  let doc: WorldDoc = emptyDoc();
  doc = applyCommand(doc, buildAddNode(textNode('a', 0, 0, 100, 100)));
  doc = applyCommand(doc, buildAddNode(textNode('b', 50, 50, 100, 100)));
  const hit = hitTestNode(doc, { x: 75, y: 75 });
  assert.equal(hit?.id, 'b'); // later node renders on top
  assert.equal(hitTestNode(doc, { x: 10, y: 10 })?.id, 'a');
  assert.equal(hitTestNode(doc, { x: 500, y: 500 }), null);
});

test('edgeAnchor returns the midpoint of each side', () => {
  const rect = { x: 0, y: 0, width: 100, height: 40 };
  assert.deepEqual(edgeAnchor(rect, 'top'), { x: 50, y: 0 });
  assert.deepEqual(edgeAnchor(rect, 'bottom'), { x: 50, y: 40 });
  assert.deepEqual(edgeAnchor(rect, 'left'), { x: 0, y: 20 });
  assert.deepEqual(edgeAnchor(rect, 'right'), { x: 100, y: 20 });
});

test('pointInPolygon detects inside vs outside a square', () => {
  const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  assert.equal(pointInPolygon({ x: 5, y: 5 }, square), true);
  assert.equal(pointInPolygon({ x: 20, y: 20 }, square), false);
});

test('nodesInLasso selects nodes whose center is inside the polygon', () => {
  let doc: WorldDoc = emptyDoc();
  doc = applyCommand(doc, buildAddNode(textNode('inside', 0, 0, 20, 20)));
  doc = applyCommand(doc, buildAddNode(textNode('outside', 1000, 1000, 20, 20)));
  const lasso = [{ x: -50, y: -50 }, { x: 50, y: -50 }, { x: 50, y: 50 }, { x: -50, y: 50 }];
  assert.deepEqual(nodesInLasso(doc, lasso), ['inside']);
});

test('nodesAlongStroke collapses consecutive repeats and skips gaps', () => {
  let doc: WorldDoc = emptyDoc();
  doc = applyCommand(doc, buildAddNode(textNode('a', 0, 0, 50, 50)));
  doc = applyCommand(doc, buildAddNode(textNode('b', 200, 0, 50, 50)));
  const stroke = [
    { x: 10, y: 10 }, { x: 20, y: 20 }, // both hit 'a'
    { x: 100, y: 100 }, // gap (hits nothing)
    { x: 210, y: 10 }, // hits 'b'
  ];
  const hits = nodesAlongStroke(doc, stroke).map((n) => n.id);
  assert.deepEqual(hits, ['a', 'b']);
});

test('buildLinkLassoEdges connects every node the stroke crosses, in order', () => {
  let doc: WorldDoc = emptyDoc();
  doc = applyCommand(doc, buildAddNode(textNode('a', 0, 0, 50, 50)));
  doc = applyCommand(doc, buildAddNode(textNode('b', 200, 0, 50, 50)));
  doc = applyCommand(doc, buildAddNode(textNode('c', 400, 0, 50, 50)));
  const stroke = [{ x: 10, y: 10 }, { x: 210, y: 10 }, { x: 410, y: 10 }];
  const cmd = buildLinkLassoEdges(doc, stroke);
  assert.ok(cmd);
  const next = applyCommand(doc, cmd!);
  assert.equal(next.edges.length, 2);
  const pairs = next.edges.map((e) => `${e.fromNode}-${e.toNode}`).sort();
  assert.deepEqual(pairs, ['a-b', 'b-c']);
});

test('buildLinkLassoEdges returns null when the stroke touches fewer than 2 nodes', () => {
  let doc: WorldDoc = emptyDoc();
  doc = applyCommand(doc, buildAddNode(textNode('a', 0, 0, 50, 50)));
  assert.equal(buildLinkLassoEdges(doc, [{ x: 10, y: 10 }]), null);
});

test('JSON Canvas round-trip preserves text, subtext, note refs, media kind, groups, parentId, rotation and edge labels', () => {
  let doc: WorldDoc = emptyDoc();
  doc = applyCommand(doc, buildAddNode({ id: 'g', type: 'group', x: 0, y: 0, width: 500, height: 500, label: 'A Group' } as GroupNode));
  doc = applyCommand(doc, buildAddNode({ id: 't', type: 'text', x: 0, y: 0, width: 100, height: 50, text: 'Hello', subtext: 'a subline', parentId: 'g', rotation: 15 } as TextNode));
  doc = applyCommand(doc, buildAddNode({ id: 'n', type: 'note', x: 10, y: 10, width: 100, height: 50, noteId: 'note-123' } as NoteNode));
  doc = applyCommand(doc, buildAddNode({ id: 'm', type: 'media', x: 20, y: 20, width: 100, height: 50, src: '/__media/x.png', kind: 'image', name: 'x.png' } as MediaNode));
  const edgeCmd = buildAddEdge(doc, 't', 'n', { label: 'links to' });
  doc = applyCommand(doc, edgeCmd!);

  const json = toJsonCanvas(doc);
  const restored = fromJsonCanvas(json);

  assert.equal(restored.nodes.length, 4);
  const t = restored.nodes.find((n) => n.id === 't') as TextNode;
  assert.equal(t.text, 'Hello');
  assert.equal(t.subtext, 'a subline');
  assert.equal(t.parentId, 'g');
  assert.equal(t.rotation, 15);
  const n = restored.nodes.find((x) => x.id === 'n') as NoteNode;
  assert.equal(n.type, 'note');
  assert.equal(n.noteId, 'note-123');
  assert.equal(n.parentId, undefined);
  const m = restored.nodes.find((x) => x.id === 'm') as MediaNode;
  assert.equal(m.type, 'media');
  assert.equal(m.kind, 'image');
  assert.equal(m.src, '/__media/x.png');
  const g = restored.nodes.find((x) => x.id === 'g') as GroupNode;
  assert.equal(g.type, 'group');
  assert.equal(g.label, 'A Group');
  assert.equal(restored.edges.length, 1);
  assert.equal(restored.edges[0].label, 'links to');
});

test('JSON Canvas round-trip preserves group folderId, media noteId, and edge linkHref (Phase 4)', () => {
  let doc: WorldDoc = emptyDoc();
  doc = applyCommand(doc, buildAddNode({ id: 'g', type: 'group', x: 0, y: 0, width: 500, height: 500, label: 'Research', folderId: 'Research' } as GroupNode));
  doc = applyCommand(doc, buildAddNode({ id: 'n1', type: 'note', x: 0, y: 0, width: 100, height: 50, noteId: 'note-1' } as NoteNode));
  doc = applyCommand(doc, buildAddNode({ id: 'n2', type: 'note', x: 200, y: 0, width: 100, height: 50, noteId: 'note-2' } as NoteNode));
  doc = applyCommand(doc, buildAddNode({ id: 'm', type: 'media', x: 20, y: 20, width: 100, height: 50, src: '/__media/x.png', kind: 'image', name: 'x.png', noteId: 'note-3' } as MediaNode));
  const edgeCmd = buildAddEdge(doc, 'n1', 'n2', { label: undefined });
  doc = applyCommand(doc, edgeCmd!);
  doc = { ...doc, edges: doc.edges.map((e) => ({ ...e, linkHref: 'Note%202.md' })) };

  const restored = fromJsonCanvas(toJsonCanvas(doc));
  const g = restored.nodes.find((n) => n.id === 'g') as GroupNode;
  assert.equal(g.folderId, 'Research');
  const m = restored.nodes.find((n) => n.id === 'm') as MediaNode;
  assert.equal(m.noteId, 'note-3');
  assert.equal(restored.edges[0].linkHref, 'Note%202.md');
});

test('JSON Canvas round-trip preserves a custom (non-preset) hex node color', () => {
  let doc: WorldDoc = emptyDoc();
  doc = applyCommand(doc, buildAddNode({ ...textNode('a'), color: '#123abc' } as TextNode));
  const restored = fromJsonCanvas(toJsonCanvas(doc));
  assert.equal(restored.nodes[0].color, '#123abc');
});

test('noteIdOf: note nodes always, media nodes only when wrapped, text/group never', () => {
  assert.equal(noteIdOf({ id: 'n', type: 'note', x: 0, y: 0, width: 1, height: 1, noteId: 'abc' } as NoteNode), 'abc');
  assert.equal(noteIdOf({ id: 'm1', type: 'media', x: 0, y: 0, width: 1, height: 1, src: '', kind: 'file', noteId: 'xyz' } as MediaNode), 'xyz');
  assert.equal(noteIdOf({ id: 'm2', type: 'media', x: 0, y: 0, width: 1, height: 1, src: '', kind: 'file' } as MediaNode), null);
  assert.equal(noteIdOf({ id: 't', type: 'text', x: 0, y: 0, width: 1, height: 1, text: '' } as TextNode), null);
  assert.equal(noteIdOf({ id: 'g', type: 'group', x: 0, y: 0, width: 1, height: 1 } as GroupNode), null);
});

test('fromJsonCanvas silently drops unknown node types (e.g. an Obsidian web-embed "link")', () => {
  const raw = JSON.stringify({
    nodes: [
      { id: 'a', type: 'text', x: 0, y: 0, width: 100, height: 50, text: 'kept' },
      { id: 'w', type: 'link', x: 0, y: 0, width: 100, height: 50, url: 'https://example.com' },
    ],
    edges: [],
  });
  const doc = fromJsonCanvas(raw);
  assert.equal(doc.nodes.length, 1);
  assert.equal(doc.nodes[0].id, 'a');
});

test('slugify normalizes names and uniqueSlug avoids collisions', () => {
  assert.equal(slugify('My World!'), 'my-world');
  assert.equal(slugify('   '), 'world');
  assert.equal(uniqueSlug(['my-world'], 'my-world'), 'my-world-2');
  assert.equal(uniqueSlug(['my-world', 'my-world-2'], 'my-world'), 'my-world-3');
  assert.equal(uniqueSlug([], 'my-world'), 'my-world');
});

test('colorHex maps default and unknown to lime, known keys to their swatch, and passes through a custom hex', () => {
  assert.equal(colorHex('default'), '#32CD32');
  assert.equal(colorHex(undefined), '#32CD32');
  assert.equal(colorHex('1'), '#ef4444');
  assert.equal(colorHex('#123abc'), '#123abc'); // custom picker value passes through untouched
});

// Exact hex -> hue (degrees), used only to verify no generated swatch falls in the purple/violet band.
function hueOf(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d === 0) return 0; // gray — hueless, never "purple"
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

test('WORLD_PALETTE has no purple/violet hues and each swatch key resolves to its own hex', () => {
  for (const sw of WORLD_PALETTE) {
    assert.equal(colorHex(sw.key), sw.hex);
    const h = hueOf(sw.hex);
    assert.ok(h < 260 || h >= 300, `${sw.label} (${sw.hex}, hue ${Math.round(h)}) is in the purple/violet band`);
  }
  assert.ok(WORLD_PALETTE.length >= 40);
});

test('edgeColor defaults to lime, inherits a colored endpoint, and prefers an explicit edge color', () => {
  let doc: WorldDoc = emptyDoc();
  doc = applyCommand(doc, buildAddNode(textNode('a', 0, 0, 50, 50)));
  doc = applyCommand(doc, buildAddNode({ ...textNode('b', 200, 0, 50, 50), color: '2' }));
  const edge: WorldEdge = { id: 'e1', fromNode: 'a', toNode: 'b' };
  assert.equal(edgeColor(doc, edge), '#f59e0b'); // inherited from 'b'

  const explicit: WorldEdge = { id: 'e2', fromNode: 'a', toNode: 'b', color: '5' };
  assert.equal(edgeColor(doc, explicit), '#06b6d4'); // explicit wins

  let plainDoc: WorldDoc = emptyDoc();
  plainDoc = applyCommand(plainDoc, buildAddNode(textNode('x')));
  plainDoc = applyCommand(plainDoc, buildAddNode(textNode('y', 100)));
  assert.equal(edgeColor(plainDoc, { id: 'e3', fromNode: 'x', toNode: 'y' }), '#32CD32');
});

test('rectFromPoints normalizes a drag regardless of direction', () => {
  assert.deepEqual(rectFromPoints({ x: 100, y: 100 }, { x: 20, y: 40 }), { x: 20, y: 40, width: 80, height: 60 });
  assert.deepEqual(rectFromPoints({ x: 0, y: 0 }, { x: 50, y: 30 }), { x: 0, y: 0, width: 50, height: 30 });
});

test('nodesInRect selects overlapping nodes and excludes disjoint ones', () => {
  let doc: WorldDoc = emptyDoc();
  doc = applyCommand(doc, buildAddNode(textNode('inside', 10, 10, 50, 50)));
  doc = applyCommand(doc, buildAddNode(textNode('partial', 90, 10, 50, 50)));
  doc = applyCommand(doc, buildAddNode(textNode('outside', 1000, 1000, 50, 50)));
  const marquee = { x: 0, y: 0, width: 120, height: 100 };
  assert.deepEqual(nodesInRect(doc, marquee).sort(), ['inside', 'partial']);
});

test('segmentsIntersect detects crossing and non-crossing segments', () => {
  assert.equal(segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 }), true);
  assert.equal(segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 5 }, { x: 10, y: 5 }), false);
});

test('edgeCutByStroke is true when a stroke crosses the wire and false when it misses', () => {
  const from = { x: 0, y: 0, width: 50, height: 50 };
  const to = { x: 200, y: 0, width: 50, height: 50 };
  const crossing = [{ x: 120, y: -50 }, { x: 120, y: 50 }];
  const missing = [{ x: 120, y: 500 }, { x: 120, y: 600 }];
  assert.equal(edgeCutByStroke(from, to, 'right', 'left', crossing), true);
  assert.equal(edgeCutByStroke(from, to, 'right', 'left', missing), false);
});

test('linkedNodeIds returns exactly the endpoints of existing edges', () => {
  let doc: WorldDoc = emptyDoc();
  doc = applyCommand(doc, buildAddNode(textNode('a')));
  doc = applyCommand(doc, buildAddNode(textNode('b', 200)));
  doc = applyCommand(doc, buildAddNode(textNode('c', 400)));
  const edgeCmd = buildAddEdge(doc, 'a', 'b');
  doc = applyCommand(doc, edgeCmd!);
  const linked = linkedNodeIds(doc);
  assert.deepEqual([...linked].sort(), ['a', 'b']);
  assert.equal(linked.has('c'), false);
});

test('nextImportOrigin sits to the right of content, and layoutImportColumn stacks without overlap', () => {
  let doc: WorldDoc = emptyDoc();
  doc = applyCommand(doc, buildAddNode(textNode('a', 0, 0, 100, 100)));
  const origin = nextImportOrigin(doc);
  assert.equal(origin.x, 180); // bounds.x(0) + bounds.width(100) + 80
  assert.equal(origin.y, 0);

  const points = layoutImportColumn(origin, [{ width: 100, height: 50 }, { width: 100, height: 80 }], 20);
  assert.deepEqual(points, [{ x: 180, y: 0 }, { x: 180, y: 70 }]);
  assert.equal(nodeBounds(emptyDoc()), null);
  assert.deepEqual(nextImportOrigin(emptyDoc()), { x: 80, y: 80 });
});

test('fitMediaSize clamps oversized images down and undersized ones up, leaving mid-range sizes untouched', () => {
  assert.deepEqual(fitMediaSize(640, 320), { width: 320, height: 160 }); // oversized -> clamped to MEDIA_MAX
  assert.deepEqual(fitMediaSize(100, 60), { width: 160, height: 96 }); // undersized -> scaled up to MEDIA_MIN
  assert.deepEqual(fitMediaSize(200, 150), { width: 200, height: 150 }); // within range -> untouched
  assert.deepEqual(fitMediaSize(0, 0), { width: 260, height: 160 }); // no natural size (audio) -> fallback box
});

test('childrenOf returns nodes by explicit parentId, ignoring geometry', () => {
  let doc: WorldDoc = emptyDoc();
  doc = applyCommand(doc, buildAddNode({ ...textNode('a', 0, 0, 20, 20), parentId: 'g' } as TextNode));
  // 'b' overhangs far outside any group's bounds but is still explicitly attached.
  doc = applyCommand(doc, buildAddNode({ ...textNode('b', 9999, 9999, 20, 20), parentId: 'g' } as TextNode));
  doc = applyCommand(doc, buildAddNode(textNode('c', 0, 0, 20, 20)));
  const kids = childrenOf(doc, 'g').map((n) => n.id).sort();
  assert.deepEqual(kids, ['a', 'b']);
});

test('groupAt finds the topmost group containing a point and respects excludeId', () => {
  let doc: WorldDoc = emptyDoc();
  doc = applyCommand(doc, buildAddNode({ id: 'g1', type: 'group', x: 0, y: 0, width: 100, height: 100 } as GroupNode));
  doc = applyCommand(doc, buildAddNode({ id: 'g2', type: 'group', x: 10, y: 10, width: 50, height: 50 } as GroupNode));
  const hit = groupAt(doc, { x: 30, y: 30 });
  assert.equal(hit?.id, 'g2'); // later/topmost group wins when both contain the point
  assert.equal(groupAt(doc, { x: 30, y: 30 }, 'g2')?.id, 'g1'); // excluding it falls back to the other
  assert.equal(groupAt(doc, { x: 500, y: 500 }), null);
});

test('buildAttachToGroup sets parentId + position as one patch, and clears parentId to detach', () => {
  let doc: WorldDoc = emptyDoc();
  doc = applyCommand(doc, buildAddNode(textNode('a', 0, 0, 20, 20)));
  const attachCmd = buildAttachToGroup(doc, 'a', 'g', 40, 50);
  assert.ok(attachCmd);
  const attached = applyCommand(doc, attachCmd!);
  const a = attached.nodes[0] as TextNode;
  assert.equal(a.parentId, 'g');
  assert.equal(a.x, 40);
  assert.equal(a.y, 50);
  const back = applyCommand(attached, invertCommand(attachCmd!));
  assert.deepEqual(back, doc); // undo restores original position and no parentId

  const detachCmd = buildAttachToGroup(attached, 'a', undefined, 100, 100);
  const detached = applyCommand(attached, detachCmd!);
  assert.equal((detached.nodes[0] as TextNode).parentId, undefined);
});

test('captionFontSize scales with node size and clamps to sane min/max for title vs body', () => {
  assert.equal(captionFontSize(1000, 1000, 'title'), 28); // clamps to max
  assert.equal(captionFontSize(10, 10, 'title'), 15); // clamps to min
  assert.equal(captionFontSize(240, 168, 'title'), 20); // mid-range: min(240/12,168/6)=20
  assert.equal(captionFontSize(1000, 1000, 'body'), 16); // clamps to max
  assert.equal(captionFontSize(10, 10, 'body'), 10); // clamps to min
});

test('sizeNodeToRect fills the given rect but never shrinks below the minimum', () => {
  assert.deepEqual(sizeNodeToRect({ x: 10, y: 20, width: 300, height: 200 }), { x: 10, y: 20, width: 300, height: 200 });
  assert.deepEqual(sizeNodeToRect({ x: 0, y: 0, width: 20, height: 10 }), { x: 0, y: 0, width: 80, height: 50 });
});

test('angleBetween measures the signed rotation swept from one point to another around a center', () => {
  const center = { x: 0, y: 0 };
  assert.equal(Math.round(angleBetween(center, { x: 10, y: 0 }, { x: 0, y: 10 })), 90);
  assert.equal(Math.round(angleBetween(center, { x: 10, y: 0 }, { x: 10, y: 0 })), 0);
  assert.equal(Math.round(angleBetween(center, { x: 0, y: 10 }, { x: 10, y: 0 })), -90);
});

test('JSON Canvas round-trip preserves edge tagRef (Phase 5)', () => {
  let doc: WorldDoc = emptyDoc();
  doc = applyCommand(doc, buildAddNode(textNode('a')));
  doc = applyCommand(doc, buildAddNode(textNode('b', 200)));
  const edgeCmd = buildAddEdge(doc, 'a', 'b');
  doc = applyCommand(doc, edgeCmd!);
  doc = { ...doc, edges: doc.edges.map((e) => ({ ...e, tagRef: '#my-tag' })) };
  const restored = fromJsonCanvas(toJsonCanvas(doc));
  assert.equal(restored.edges[0].tagRef, '#my-tag');
});

test('fisheyeScale peaks at the focus, decays to 1 at radius, and is monotonically decreasing', () => {
  const focus = { x: 0, y: 0 };
  const atFocus = fisheyeScale(focus, focus, 100);
  const atHalf = fisheyeScale({ x: 50, y: 0 }, focus, 100);
  const atRadius = fisheyeScale({ x: 100, y: 0 }, focus, 100);
  const beyond = fisheyeScale({ x: 500, y: 0 }, focus, 100);
  assert.ok(atFocus > atHalf);
  assert.ok(atHalf > atRadius);
  assert.equal(atRadius, 1);
  assert.equal(beyond, 1);
  assert.equal(fisheyeScale(focus, focus, 0), 1); // zero radius -> no-op
});

test('buildWorkspaceImport creates a bound group with member notes, a root note, and a link edge', () => {
  const ws: WorkspaceSnapshot = {
    notes: [
      { id: 'n1', title: 'Alpha', content: '<p><a href="Beta.md">Beta</a></p>', folderId: 'Research' },
      { id: 'n2', title: 'Beta', content: '<p>hi</p>', folderId: 'Research' },
      { id: 'n3', title: 'Gamma', content: '<p>root note</p>', folderId: null },
    ],
    folders: [{ id: 'Research', name: 'Research' }],
    noteExtensions: { n1: '.md', n2: '.md', n3: '.md' },
  };
  const cmd = buildWorkspaceImport(emptyDoc(), ws);
  assert.ok(cmd);
  assert.equal(cmd!.type, 'add');
  const doc = applyCommand(emptyDoc(), cmd!);

  const group = doc.nodes.find((n) => n.type === 'group') as GroupNode;
  assert.ok(group);
  assert.equal(group.folderId, 'Research');
  assert.equal(group.label, 'Research');

  const n1Node = doc.nodes.find((n) => n.type === 'note' && (n as NoteNode).noteId === 'n1') as NoteNode;
  const n2Node = doc.nodes.find((n) => n.type === 'note' && (n as NoteNode).noteId === 'n2') as NoteNode;
  const n3Node = doc.nodes.find((n) => n.type === 'note' && (n as NoteNode).noteId === 'n3') as NoteNode;
  assert.equal(n1Node.parentId, group.id);
  assert.equal(n2Node.parentId, group.id);
  assert.equal(n3Node.parentId, undefined); // root note, not in the folder

  assert.equal(doc.edges.length, 1);
  assert.equal(doc.edges[0].fromNode, n1Node.id);
  assert.equal(doc.edges[0].toNode, n2Node.id);
  assert.equal(doc.edges[0].linkHref, 'Beta.md');
});

test('buildWorkspaceImport skips notes already represented, and is idempotent on the resulting doc', () => {
  const ws: WorkspaceSnapshot = {
    notes: [{ id: 'n1', title: 'Alpha', content: '<p>hi</p>', folderId: null }],
    folders: [],
    noteExtensions: { n1: '.md' },
  };
  const cmd = buildWorkspaceImport(emptyDoc(), ws);
  const doc = applyCommand(emptyDoc(), cmd!);
  assert.equal(buildWorkspaceImport(doc, ws), null);
});

test('buildWorkspaceImport wraps a media-only note as a media node carrying noteId', () => {
  const ws: WorkspaceSnapshot = {
    notes: [{ id: 'n1', title: 'photo', content: '<img src="/__media/x.png" alt="x.png" />', folderId: null }],
    folders: [],
    noteExtensions: { n1: '.md' },
  };
  const doc = applyCommand(emptyDoc(), buildWorkspaceImport(emptyDoc(), ws)!);
  const m = doc.nodes.find((n) => n.type === 'media') as MediaNode;
  assert.ok(m);
  assert.equal(m.noteId, 'n1');
  assert.equal(m.kind, 'image');
  assert.equal(m.src, '/__media/x.png');
});

test('rotatePoint rotates around a center and is a no-op for 0 degrees', () => {
  const center = { x: 0, y: 0 };
  const rotated = rotatePoint({ x: 10, y: 0 }, center, 90);
  assert.equal(Math.round(rotated.x), 0);
  assert.equal(Math.round(rotated.y), 10);
  assert.deepEqual(rotatePoint({ x: 5, y: 5 }, center, 0), { x: 5, y: 5 });
});

test('hitTestNode is rotation-aware: finds a point in a rotated corner an AABB test would miss/mishit', () => {
  let doc: WorldDoc = emptyDoc();
  // A 100x100 node centered at (50,50), rotated 45deg — its AABB corner (95,95) is
  // now empty space (rotated away), while a point outside the original AABB, at
  // the rotated top-right corner, now falls inside the node.
  doc = applyCommand(doc, buildAddNode({ ...textNode('a', 0, 0, 100, 100), rotation: 45 } as TextNode));
  // Original top-right corner (100,0) rotated 45deg clockwise about (50,50) lands outside the unrotated box.
  const rotatedCorner = rotatePoint({ x: 100, y: 0 }, { x: 50, y: 50 }, 45);
  assert.equal(hitTestNode(doc, rotatedCorner)?.id, 'a');
  // A point just inside the original AABB's corner (99,99) is rotated away from the node's actual area.
  assert.equal(hitTestNode(doc, { x: 99, y: 99 }), null);
});

test('groupAt is rotation-aware the same way as hitTestNode', () => {
  let doc: WorldDoc = emptyDoc();
  doc = applyCommand(doc, buildAddNode({ id: 'g', type: 'group', x: 0, y: 0, width: 100, height: 100, rotation: 45 } as GroupNode));
  const rotatedCorner = rotatePoint({ x: 100, y: 0 }, { x: 50, y: 50 }, 45);
  assert.equal(groupAt(doc, rotatedCorner)?.id, 'g');
  assert.equal(groupAt(doc, { x: 99, y: 99 }), null);
});

test('nodesInRect uses a rotated node\'s rotated-corner bounding box, and is unchanged for unrotated nodes', () => {
  let doc: WorldDoc = emptyDoc();
  doc = applyCommand(doc, buildAddNode({ ...textNode('rot', 0, 0, 100, 100), rotation: 45 } as TextNode));
  // A 45deg-rotated 100x100 box's bounding box spans roughly [-20.7, 120.7] around its center (50,50) —
  // this rect sits past the ORIGINAL unrotated box's edge (x=100) but within the rotated bounding box.
  const marqueeNearRotatedTip = { x: 110, y: 45, width: 10, height: 10 };
  assert.deepEqual(nodesInRect(doc, marqueeNearRotatedTip), ['rot']);
  assert.deepEqual(nodesInRect(doc, { x: 1000, y: 1000, width: 10, height: 10 }), []);
});

test('layoutImportCross places items on 4 arms without overlap and unrotated positions stay reasonable', () => {
  const sizes = Array.from({ length: 5 }, () => ({ width: 40, height: 20 }));
  const points = layoutImportCross({ x: 0, y: 0 }, sizes, 10);
  assert.equal(points.length, 5);
  // First 4 land on distinct arms (N, E, S, W) — none share both x and y.
  const first4 = points.slice(0, 4);
  const centers = first4.map((p, i) => ({ x: p.x + sizes[i].width / 2, y: p.y + sizes[i].height / 2 }));
  assert.ok(centers[0].y < 0 && Math.round(centers[0].x) === 0); // N
  assert.ok(centers[1].x > 0 && Math.round(centers[1].y) === 0); // E
  assert.ok(centers[2].y > 0 && Math.round(centers[2].x) === 0); // S
  assert.ok(centers[3].x < 0 && Math.round(centers[3].y) === 0); // W
  // 5th item continues on the N arm, further out than the 1st.
  const center5 = { x: points[4].x + sizes[4].width / 2, y: points[4].y + sizes[4].height / 2 };
  assert.ok(center5.y < centers[0].y);
});

test('buildWorkspaceImport with a folders scope imports only notes in those folders', () => {
  const ws: WorkspaceSnapshot = {
    notes: [
      { id: 'n1', title: 'Alpha', content: '<p>hi</p>', folderId: 'Research' },
      { id: 'n2', title: 'Beta', content: '<p>hi</p>', folderId: 'Personal' },
      { id: 'n3', title: 'Gamma', content: '<p>root note</p>', folderId: null },
    ],
    folders: [{ id: 'Research', name: 'Research' }, { id: 'Personal', name: 'Personal' }],
    noteExtensions: { n1: '.md', n2: '.md', n3: '.md' },
  };
  const cmd = buildWorkspaceImport(emptyDoc(), ws, { kind: 'folders', folderIds: ['Research'] });
  assert.ok(cmd);
  const doc = applyCommand(emptyDoc(), cmd!);
  const importedNoteIds = doc.nodes.map(noteIdOf).filter((x): x is string => !!x);
  assert.deepEqual(importedNoteIds, ['n1']);
});

test('buildWorkspaceImport with a folders scope is idempotent and defaults to "all" when scope is omitted', () => {
  const ws: WorkspaceSnapshot = {
    notes: [{ id: 'n1', title: 'Alpha', content: '<p>hi</p>', folderId: 'Research' }],
    folders: [{ id: 'Research', name: 'Research' }],
    noteExtensions: { n1: '.md' },
  };
  const scope: ImportScope = { kind: 'folders', folderIds: ['Research'] };
  const cmd = buildWorkspaceImport(emptyDoc(), ws, scope);
  const doc = applyCommand(emptyDoc(), cmd!);
  assert.equal(buildWorkspaceImport(doc, ws, scope), null); // idempotent under the same scope

  // Omitting scope defaults to 'all', matching the pre-item-13 Mirror Workspace behavior.
  const allDoc = applyCommand(emptyDoc(), buildWorkspaceImport(emptyDoc(), ws)!);
  assert.equal(allDoc.nodes.filter((n) => noteIdOf(n) === 'n1').length, 1);
});

test('buildWorkspaceImport reuses an existing bound group instead of creating a duplicate', () => {
  let doc: WorldDoc = emptyDoc();
  doc = applyCommand(doc, buildAddNode({ id: 'g', type: 'group', x: 0, y: 0, width: 420, height: 320, label: 'Research', folderId: 'Research' } as GroupNode));
  const ws: WorkspaceSnapshot = {
    notes: [{ id: 'n1', title: 'Alpha', content: '<p>hi</p>', folderId: 'Research' }],
    folders: [{ id: 'Research', name: 'Research' }],
    noteExtensions: { n1: '.md' },
  };
  const next = applyCommand(doc, buildWorkspaceImport(doc, ws)!);
  const groups = next.nodes.filter((n) => n.type === 'group');
  assert.equal(groups.length, 1);
  const n1Node = next.nodes.find((n) => n.type === 'note') as NoteNode;
  assert.equal(n1Node.parentId, 'g');
});

test('invertCommand preserves the worldOnly flag both directions (Clear tool)', () => {
  const node = { id: 'n1', type: 'text' as const, x: 0, y: 0, width: 100, height: 60, text: 'x' };
  const clear = { type: 'remove' as const, nodes: [node], edges: [], worldOnly: true };
  const inv = invertCommand(clear);
  assert.equal(inv.type, 'add');
  assert.equal((inv as any).worldOnly, true);
  const reinv = invertCommand(inv);
  assert.equal(reinv.type, 'remove');
  assert.equal((reinv as any).worldOnly, true);
});

test('worldCardTags reads a tag from every text card, unwired or not', () => {
  const doc: WorldDoc = {
    nodes: [
      textNode('a', 0, 0, 100, 50, 'Research Idea'),
      textNode('b', 0, 0, 100, 50, ''), // blank card: no tag yet
      { id: 'c', type: 'note', x: 0, y: 0, width: 100, height: 50, noteId: 'n1' } as NoteNode,
    ],
    edges: [],
  };
  assert.deepEqual(worldCardTags(doc), ['research-idea']);
});

test('worldCardTags dedupes case/text variants that slugify to the same tag', () => {
  const doc: WorldDoc = {
    nodes: [textNode('a', 0, 0, 100, 50, 'My Tag'), textNode('b', 0, 0, 100, 50, 'my tag')],
    edges: [],
  };
  assert.deepEqual(worldCardTags(doc), ['my-tag']);
});
