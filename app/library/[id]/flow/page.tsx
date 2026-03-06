"use client"

import { useState, useCallback, useEffect, useMemo, use } from "react"
import { useRouter } from "next/navigation"
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeMouseHandler,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import dagre from "@dagrejs/dagre"
import { ArrowLeftIcon, Loader2Icon, AlertCircleIcon, GitBranchIcon } from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Paywall } from "@/components/ui/paywall"
import { FlowNode, type FlowNodeData } from "@/components/ui/flow-node"
import { useLocale } from "@/hooks/use-locale"
import { useLicenseStatus } from "@/hooks/use-api"
import { api } from "@/lib/api"

// ── Dagre layout ──

const NODE_WIDTH = 200
const NODE_HEIGHT = 80

function getLayoutedElements(
  rawNodes: Node[],
  rawEdges: Edge[],
  direction: "TB" | "LR" = "TB"
): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: direction, nodesep: 40, ranksep: 60 })

  rawNodes.forEach((n) => {
    g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT })
  })
  rawEdges.forEach((e) => {
    g.setEdge(e.source, e.target)
  })

  dagre.layout(g)

  const layoutedNodes = rawNodes.map((n) => {
    const pos = g.node(n.id)
    return {
      ...n,
      position: {
        x: pos.x - NODE_WIDTH / 2,
        y: pos.y - NODE_HEIGHT / 2,
      },
    }
  })

  return { nodes: layoutedNodes, edges: rawEdges }
}

// ── Node type registry ──
const nodeTypes = { flowNode: FlowNode }

// ── Legend ──
function Legend() {
  const { t } = useLocale()
  const items = [
    { color: "bg-green-500", label: t("flowFullyTranslated") },
    { color: "bg-yellow-500", label: t("flowPartiallyTranslated") },
    { color: "bg-slate-500", label: t("flowUntranslated") },
    { color: "bg-red-500", label: t("flowQaErrors") },
  ]
  return (
    <div className="absolute bottom-4 left-4 z-10 rounded-lg border border-overlay-6 bg-overlay-2/90 px-3 py-2 text-xs backdrop-blur-sm flex flex-col gap-1.5">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-2">
          <span className={`size-2.5 rounded-sm ${item.color}`} />
          <span className="text-text-secondary">{item.label}</span>
        </div>
      ))}
    </div>
  )
}

// ── Main page ──
export default function FlowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = use(params)
  const gameId = Number(idStr)
  const router = useRouter()
  const { t } = useLocale()
  const { license, refresh: refreshLicense } = useLicenseStatus()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])

  // Fetch structure data and build graph
  useEffect(() => {
    if (!gameId) return
    setLoading(true)
    setError(null)

    api.games
      .structure(gameId)
      .then((data) => {
        if (!data.nodes.length) {
          setLoading(false)
          return
        }

        // Map API nodes to ReactFlow nodes
        const rawNodes: Node[] = data.nodes.map((n) => ({
          id: n.id,
          type: "flowNode",
          position: { x: 0, y: 0 },
          data: {
            label: n.label,
            total: n.total,
            translated: n.translated,
            errors: n.errors,
            type: n.type as FlowNodeData["type"],
          } satisfies FlowNodeData,
        }))

        // Map API edges to ReactFlow edges
        const rawEdges: Edge[] = data.edges.map((e, i) => ({
          id: `e-${e.source}-${e.target}-${i}`,
          source: e.source,
          target: e.target,
          label: e.label,
          animated: !!e.label,
          style: { stroke: "var(--color-overlay-6, #555)" },
          labelStyle: { fill: "var(--color-text-secondary, #aaa)", fontSize: 10 },
        }))

        const { nodes: layouted, edges: layoutedEdges } = getLayoutedElements(rawNodes, rawEdges)
        setNodes(layouted)
        setEdges(layoutedEdges)
        setLoading(false)
      })
      .catch((err: Error) => {
        setError(err.message)
        setLoading(false)
      })
  }, [gameId, setNodes, setEdges])

  // Navigate to string editor when a node is clicked
  const onNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      const namespace = node.id
      router.push(`/library/${gameId}/strings?namespace=${encodeURIComponent(namespace)}`)
    },
    [gameId, router]
  )

  const isEmpty = !loading && !error && nodes.length === 0

  return (
    <Paywall show={!license.valid} onLicenseVerified={refreshLicense}>
    <div className="flex flex-col h-screen bg-background text-text-primary">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-overlay-6 shrink-0">
        <Link href={`/library/${gameId}`}>
          <Button variant="ghost" size="icon">
            <ArrowLeftIcon className="size-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-base font-semibold flex items-center gap-2">
            <GitBranchIcon className="size-4 text-accent" />
            {t("flowGraph")}
          </h1>
          <p className="text-xs text-text-secondary">{t("flowGraphDesc")}</p>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 relative min-h-0">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2Icon className="size-6 animate-spin text-accent" />
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-text-secondary">
            <AlertCircleIcon className="size-8 text-red-400" />
            <p className="text-sm">{error}</p>
          </div>
        )}

        {isEmpty && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-text-secondary">
            <GitBranchIcon className="size-10 opacity-30" />
            <p className="text-sm">{t("flowNoData")}</p>
          </div>
        )}

        {!loading && !error && !isEmpty && (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={onNodeClick}
            nodeTypes={nodeTypes}
            nodesConnectable={false}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            minZoom={0.1}
            maxZoom={2}
            className="rounded-lg"
            style={{ background: "transparent" }}
          >
            <Background color="var(--color-overlay-4, #333)" gap={20} size={1} />
            <Controls className="[&>button]:bg-overlay-2 [&>button]:border-overlay-6 [&>button]:text-text-secondary" />
            <MiniMap
              nodeColor={(n) => {
                const d = n.data as unknown as FlowNodeData
                if (d.errors > 0) return "#ef4444"
                if (!d.total) return "#6b7280"
                const pct = d.translated / d.total
                if (pct >= 1) return "#22c55e"
                if (pct > 0) return "#eab308"
                return "#6b7280"
              }}
              className="!bg-overlay-2 !border-overlay-6 rounded-lg"
            />
            <Legend />
          </ReactFlow>
        )}
      </div>
    </div>
    </Paywall>
  )
}
