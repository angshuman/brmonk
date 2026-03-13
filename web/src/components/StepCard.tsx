import { useState } from 'react';
import {
  Brain, Wrench, ArrowRight, ListOrdered, CircleDot,
  CheckCircle, AlertTriangle, AlertCircle, Globe, XCircle, ChevronDown, ChevronRight,
} from 'lucide-react';
import clsx from 'clsx';
import type { AgentEvent } from '../types';

function summarizeArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args);
  if (entries.length === 0) return '';
  return entries
    .map(([k, v]) => {
      const val = typeof v === 'string' ? (v.length > 60 ? v.slice(0, 60) + '...' : v) : JSON.stringify(v);
      return `${k}: ${val}`;
    })
    .join(', ');
}

export function StepCard({ event, isLast }: { event: AgentEvent; isLast: boolean }) {
  const [expanded, setExpanded] = useState(false);

  const renderContent = () => {
    switch (event.type) {
      case 'step':
        return (
          <div className="flex items-center gap-2 text-[12px] text-muted">
            <CircleDot size={14} />
            <span>Step {event.step} of {event.maxSteps}</span>
          </div>
        );

      case 'thought':
        return (
          <div className="flex items-start gap-2">
            <Brain size={14} className="text-muted mt-0.5 flex-shrink-0" />
            <p className={clsx(
              'text-secondary text-sm',
              !expanded && event.message.length > 200 && 'line-clamp-3'
            )}>
              {event.message}
            </p>
            {event.message.length > 200 && (
              <button onClick={() => setExpanded(!expanded)} className="text-accent text-xs flex-shrink-0 mt-0.5">
                {expanded ? 'less' : 'more'}
              </button>
            )}
          </div>
        );

      case 'action':
        return (
          <div className="flex items-start gap-2">
            <Wrench size={14} className="text-accent mt-0.5 flex-shrink-0" />
            <div className="min-w-0">
              <span className="inline-block px-1.5 py-0.5 bg-accent/10 text-accent text-xs rounded font-medium">
                {event.action}
              </span>
              <p className="text-secondary text-xs mt-1 break-all">
                {expanded ? JSON.stringify(event.args, null, 2) : summarizeArgs(event.args)}
              </p>
              {Object.keys(event.args).length > 0 && (
                <button onClick={() => setExpanded(!expanded)} className="text-muted text-xs mt-0.5 flex items-center gap-0.5">
                  {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  {expanded ? 'collapse' : 'expand'}
                </button>
              )}
            </div>
          </div>
        );

      case 'action-result':
        return (
          <div className="flex items-start gap-2 ml-5">
            <ArrowRight size={12} className="text-muted mt-1 flex-shrink-0" />
            <p className={clsx(
              'text-xs text-muted bg-surface-elevated rounded px-2 py-1 break-all',
              !expanded && event.result.length > 150 && 'line-clamp-2'
            )}>
              {event.result}
            </p>
            {event.result.length > 150 && (
              <button onClick={() => setExpanded(!expanded)} className="text-accent text-xs flex-shrink-0">
                {expanded ? 'less' : 'more'}
              </button>
            )}
          </div>
        );

      case 'plan':
        return (
          <div className="flex items-start gap-2">
            <ListOrdered size={14} className="text-accent mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-xs text-muted font-medium mb-1">Plan</p>
              <ol className="list-decimal list-inside text-sm text-secondary space-y-0.5">
                {event.steps.map((s, i) => <li key={i}>{s}</li>)}
              </ol>
            </div>
          </div>
        );

      case 'plan-progress':
        return (
          <div className="flex items-center gap-2 text-xs text-muted ml-5">
            <CheckCircle size={12} className={event.status === 'done' ? 'text-success' : 'text-muted'} />
            <span>Step {event.stepIndex + 1}: {event.status}</span>
          </div>
        );

      case 'status':
        return (
          <div className="flex items-center gap-2">
            <CircleDot size={14} className={clsx(
              event.status === 'completed' ? 'text-success' :
              event.status === 'failed' ? 'text-error' :
              event.status === 'running' ? 'text-accent' : 'text-warning'
            )} />
            <span className="text-xs font-medium capitalize">{event.status.replace(/_/g, ' ')}</span>
          </div>
        );

      case 'result':
        return (
          <div className="flex items-start gap-2 bg-surface-elevated rounded-lg p-3 border border-border">
            <CheckCircle size={16} className="text-success mt-0.5 flex-shrink-0" />
            <div className="text-sm text-primary whitespace-pre-wrap break-words min-w-0">
              {event.result}
            </div>
          </div>
        );

      case 'error':
        return (
          <div className="flex items-start gap-2 bg-error/5 rounded-lg p-3 border border-error/20">
            <AlertTriangle size={16} className="text-error mt-0.5 flex-shrink-0" />
            <p className="text-sm text-error break-all">{event.error}</p>
          </div>
        );

      case 'user-action-required':
        return (
          <div className="flex items-start gap-2 bg-warning/5 rounded-lg p-3 border border-warning/20">
            <AlertCircle size={16} className="text-warning mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-warning capitalize">{event.actionType} required</p>
              <p className="text-xs text-secondary mt-0.5">{event.prompt}</p>
            </div>
          </div>
        );

      case 'user-action-resolved':
        return (
          <div className="flex items-center gap-2 text-xs text-success">
            <CheckCircle size={12} />
            <span>User action resolved</span>
          </div>
        );

      case 'popup-dismissed':
        return (
          <div className="flex items-center gap-2 text-xs text-muted">
            <XCircle size={12} />
            <span>Popup dismissed: {event.description}</span>
          </div>
        );

      case 'page-navigated':
        return (
          <div className="flex items-center gap-2 text-xs text-muted">
            <Globe size={12} />
            <span className="truncate">{event.url}</span>
          </div>
        );

      default:
        return null;
    }
  };

  const content = renderContent();
  if (!content) return null;

  return (
    <div className="relative pl-6 pb-3">
      {/* Vertical line */}
      {!isLast && (
        <div className="absolute left-[7px] top-3 bottom-0 w-px bg-chain" />
      )}
      {/* Dot */}
      <div className={clsx(
        'absolute left-0 top-1.5 w-[15px] h-[15px] rounded-full border-2 border-chain bg-background',
        isLast && event.type === 'status' && 'border-accent',
      )} />
      {content}
    </div>
  );
}
