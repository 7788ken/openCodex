import os from 'node:os';
import path from 'node:path';
import { chmod, rm, writeFile } from 'node:fs/promises';
import { parseOptions } from '../lib/args.js';
import { ensureDir } from '../lib/fs.js';
import { runCommandCapture } from '../lib/codex.js';
import { collectGlobalIslandStatus } from '../lib/global-island.js';

const DEFAULT_ISLAND_APP_NAME = 'OpenCodex Island.app';

const STATUS_OPTION_SPEC = {
  json: { type: 'boolean' },
  cwd: { type: 'string' },
  'home-dir': { type: 'string' }
};

const INSTALL_OPTION_SPEC = {
  cwd: { type: 'string' },
  'home-dir': { type: 'string' },
  'applications-dir': { type: 'string' },
  'app-path': { type: 'string' },
  'cli-path': { type: 'string' },
  'node-path': { type: 'string' },
  open: { type: 'boolean' },
  json: { type: 'boolean' }
};

const OPEN_OPTION_SPEC = {
  'home-dir': { type: 'string' },
  'applications-dir': { type: 'string' },
  'app-path': { type: 'string' },
  json: { type: 'boolean' }
};

export async function runIslandCommand(args) {
  const [subcommand, ...rest] = args;

  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    process.stdout.write(
      'Usage:\n' +
      '  opencodex island status [--json] [--cwd <dir>] [--home-dir <dir>]\n' +
      '  opencodex island install [--cwd <dir>] [--home-dir <dir>] [--applications-dir <dir>] [--app-path <path>] [--cli-path <path>] [--node-path <path>] [--open] [--json]\n' +
      '  opencodex island open [--home-dir <dir>] [--applications-dir <dir>] [--app-path <path>] [--json]\n'
    );
    return;
  }

  if (subcommand === 'status') {
    await runIslandStatus(rest);
    return;
  }

  if (subcommand === 'install') {
    await runIslandInstall(rest);
    return;
  }

  if (subcommand === 'open') {
    await runIslandOpen(rest);
    return;
  }

  throw new Error(`Unknown island subcommand: ${subcommand}`);
}

async function runIslandStatus(args) {
  const { options, positionals } = parseOptions(args, STATUS_OPTION_SPEC);
  if (positionals.length) {
    throw new Error('`opencodex island status` does not accept positional arguments');
  }

  const payload = await collectGlobalIslandStatus({
    cwd: path.resolve(options.cwd || process.cwd()),
    homeDir: options['home-dir'] ? path.resolve(options['home-dir']) : os.homedir()
  });

  if (options.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  const lines = ['OpenCodex Island Status', ''];
  lines.push(`State: ${payload.state}`);
  lines.push(`Title: ${payload.title}`);
  lines.push(`Subtitle: ${payload.subtitle}`);
  lines.push(`Detail: ${payload.detail}`);
  lines.push(`Workspaces: ${payload.counts.workspaces_count}`);
  lines.push(`Known Sessions: ${payload.counts.known_sessions_count}`);
  lines.push(`Task Sessions: ${payload.counts.task_sessions_count}`);
  lines.push(`Active: ${payload.counts.active_count}`);
  lines.push(`Waiting: ${payload.counts.waiting_count}`);
  lines.push(`Running: ${payload.counts.running_count}`);
  if (payload.focus) {
    lines.push(`Focus: ${payload.focus.display_status} • ${payload.focus.title}`);
    if (payload.focus.pending_question) {
      lines.push(`Focus Pending: ${payload.focus.pending_question}`);
    }
    lines.push(`Focus Workspace: ${payload.focus.workspace_cwd}`);
  }
  process.stdout.write(lines.join('\n') + '\n');
}

async function runIslandInstall(args) {
  const { options, positionals } = parseOptions(args, INSTALL_OPTION_SPEC);
  if (positionals.length) {
    throw new Error('`opencodex island install` does not accept positional arguments');
  }

  const paths = resolveIslandPaths(options);
  await ensureDir(paths.stateRoot);
  await ensureDir(path.dirname(paths.appPath));
  await ensureDir(paths.binaryDir);

  const nodePath = path.resolve(options['node-path'] || process.execPath);
  const cliPath = path.resolve(options['cli-path'] || path.join(process.cwd(), 'bin', 'opencodex.js'));
  const statusCwd = path.resolve(options.cwd || process.cwd());
  const homeDir = path.resolve(options['home-dir'] || os.homedir());

  await writeFile(paths.sourcePath, buildIslandSwiftSource({ nodePath, cliPath, homeDir, statusCwd }), 'utf8');
  await rm(paths.appPath, { recursive: true, force: true });
  await ensureDir(paths.binaryDir);
  await writeFile(paths.infoPlistPath, buildIslandInfoPlist(), 'utf8');

  const swiftc = resolveSwiftcBin();
  const compile = await runCommandCapture(swiftc, [
    '-O',
    '-framework', 'AppKit',
    '-framework', 'Foundation',
    '-o', paths.binaryPath,
    paths.sourcePath
  ], {
    cwd: process.cwd()
  });
  if (compile.code !== 0) {
    throw new Error(`swiftc failed: ${pickCommandFailure(compile)}`);
  }
  await chmod(paths.binaryPath, 0o755);

  if (options.open) {
    await openPath(paths.appPath);
  }

  const payload = {
    ok: true,
    action: 'install',
    app_path: paths.appPath,
    source_path: paths.sourcePath,
    binary_path: paths.binaryPath,
    info_plist_path: paths.infoPlistPath,
    node_path: nodePath,
    cli_path: cliPath,
    home_dir: homeDir,
    status_cwd: statusCwd,
    opened: Boolean(options.open)
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  process.stdout.write([
    'OpenCodex Island installed',
    '',
    `App Path: ${payload.app_path}`,
    `Swift Source: ${payload.source_path}`,
    `Binary Path: ${payload.binary_path}`,
    `CLI Path: ${payload.cli_path}`,
    options.open ? 'Opened: yes' : 'Opened: no'
  ].join('\n') + '\n');
}

async function runIslandOpen(args) {
  const { options, positionals } = parseOptions(args, OPEN_OPTION_SPEC);
  if (positionals.length) {
    throw new Error('`opencodex island open` does not accept positional arguments');
  }
  const paths = resolveIslandPaths(options);
  await openPath(paths.appPath);
  const payload = {
    ok: true,
    action: 'open',
    app_path: paths.appPath
  };
  if (options.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  process.stdout.write(`Opened ${paths.appPath}\n`);
}

function resolveIslandPaths(options = {}) {
  const homeDir = path.resolve(options['home-dir'] || os.homedir());
  const applicationsDir = path.resolve(options['applications-dir'] || path.join(homeDir, 'Applications'));
  const appPath = path.resolve(options['app-path'] || path.join(applicationsDir, DEFAULT_ISLAND_APP_NAME));
  const stateRoot = path.join(homeDir, '.opencodex', 'island');
  return {
    homeDir,
    applicationsDir,
    stateRoot,
    appPath,
    sourcePath: path.join(stateRoot, 'OpenCodexIsland.swift'),
    infoPlistPath: path.join(appPath, 'Contents', 'Info.plist'),
    binaryDir: path.join(appPath, 'Contents', 'MacOS'),
    binaryPath: path.join(appPath, 'Contents', 'MacOS', 'OpenCodexIsland')
  };
}

function buildIslandInfoPlist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>OpenCodexIsland</string>
  <key>CFBundleIdentifier</key>
  <string>com.opencodex.island</string>
  <key>CFBundleName</key>
  <string>OpenCodex Island</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
`;
}

function buildIslandSwiftSource({ nodePath, cliPath, homeDir, statusCwd }) {
  return `import AppKit
import Foundation

struct IslandCounts: Decodable {
    let workspaces_count: Int
    let known_sessions_count: Int
    let task_sessions_count: Int
    let active_count: Int
    let waiting_count: Int
    let running_count: Int
}

struct IslandFocus: Decodable {
    let session_id: String
    let command: String
    let display_status: String
    let title: String
    let detail: String
    let pending_question: String
    let updated_at: String
    let workspace_cwd: String
    let session_path: String
}

struct IslandPayload: Decodable {
    let ok: Bool
    let state: String
    let title: String
    let subtitle: String
    let detail: String
    let updated_at: String
    let counts: IslandCounts
    let focus: IslandFocus?
    let pending_messages: [IslandPendingMessage]
}

struct IslandPendingMessage: Decodable {
    let session_id: String
    let title: String
    let detail: String
    let pending_question: String
    let updated_at: String
    let workspace_cwd: String
}

final class FloatingIslandWindow: NSWindow {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

final class IslandPillView: NSView {
    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        layer?.cornerCurve = .continuous
        layer?.cornerRadius = 22
        layer?.borderWidth = 1
        layer?.masksToBounds = false
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }
}

final class MessageRowView: NSView {
    private let titleField = NSTextField(labelWithString: "")
    private let detailField = NSTextField(labelWithString: "")

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        layer?.cornerCurve = .continuous
        layer?.cornerRadius = 16
        layer?.masksToBounds = false

        titleField.font = NSFont.systemFont(ofSize: 13, weight: .semibold)
        titleField.lineBreakMode = .byTruncatingTail
        detailField.font = NSFont.systemFont(ofSize: 12, weight: .regular)
        detailField.lineBreakMode = .byTruncatingTail
        detailField.maximumNumberOfLines = 2

        let stack = NSStackView(views: [titleField, detailField])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 4
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 14),
            stack.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -14),
            stack.topAnchor.constraint(equalTo: topAnchor, constant: 12),
            stack.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -12)
        ])
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func apply(message: IslandPendingMessage, isDarkMode: Bool) {
        titleField.stringValue = message.title
        detailField.stringValue = message.pending_question.isEmpty ? message.detail : message.pending_question
        titleField.textColor = isDarkMode ? .white : .black
        detailField.textColor = isDarkMode
            ? NSColor.white.withAlphaComponent(0.78)
            : NSColor.black.withAlphaComponent(0.72)
        layer?.backgroundColor = (isDarkMode ? NSColor.white : NSColor.black).withAlphaComponent(0.06).cgColor
    }
}

final class IslandPanelView: NSView {
    private let collapsedRow = NSStackView()
    private let leftPill = IslandPillView(frame: .zero)
    private let rightPill = IslandPillView(frame: .zero)
    private let notchGap = NSView(frame: .zero)
    private let leftPrimaryField = NSTextField(labelWithString: "")
    private let leftSecondaryField = NSTextField(labelWithString: "")
    private let rightPrimaryField = NSTextField(labelWithString: "")
    private let rightSecondaryField = NSTextField(labelWithString: "")
    private let expandedPanel = IslandPillView(frame: .zero)
    private let expandedTitleField = NSTextField(labelWithString: "")
    private let expandedSubtitleField = NSTextField(labelWithString: "")
    private let expandedMetaStack = NSStackView()
    private let stateChip = IslandPillView(frame: .zero)
    private let stateChipField = NSTextField(labelWithString: "")
    private let countChip = IslandPillView(frame: .zero)
    private let countChipField = NSTextField(labelWithString: "")
    private let pendingStack = NSStackView()
    private var expandedHeightConstraint: NSLayoutConstraint?

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        leftPrimaryField.font = NSFont.systemFont(ofSize: 15, weight: .semibold)
        leftSecondaryField.font = NSFont.systemFont(ofSize: 11, weight: .medium)
        rightPrimaryField.font = NSFont.monospacedDigitSystemFont(ofSize: 16, weight: .semibold)
        rightSecondaryField.font = NSFont.systemFont(ofSize: 11, weight: .medium)
        expandedTitleField.font = NSFont.systemFont(ofSize: 16, weight: .semibold)
        expandedSubtitleField.font = NSFont.systemFont(ofSize: 12, weight: .medium)
        expandedSubtitleField.maximumNumberOfLines = 2
        expandedSubtitleField.lineBreakMode = .byTruncatingTail
        stateChipField.font = NSFont.systemFont(ofSize: 12, weight: .semibold)
        countChipField.font = NSFont.monospacedDigitSystemFont(ofSize: 12, weight: .semibold)

        let leftStack = makePillStack(fields: [leftPrimaryField, leftSecondaryField])
        let rightStack = makePillStack(fields: [rightPrimaryField, rightSecondaryField])

        leftPill.translatesAutoresizingMaskIntoConstraints = false
        rightPill.translatesAutoresizingMaskIntoConstraints = false
        notchGap.translatesAutoresizingMaskIntoConstraints = false
        leftPill.addSubview(leftStack)
        rightPill.addSubview(rightStack)

        NSLayoutConstraint.activate([
            leftStack.leadingAnchor.constraint(equalTo: leftPill.leadingAnchor, constant: 16),
            leftStack.trailingAnchor.constraint(equalTo: leftPill.trailingAnchor, constant: -16),
            leftStack.centerYAnchor.constraint(equalTo: leftPill.centerYAnchor),
            rightStack.leadingAnchor.constraint(equalTo: rightPill.leadingAnchor, constant: 16),
            rightStack.trailingAnchor.constraint(equalTo: rightPill.trailingAnchor, constant: -16),
            rightStack.centerYAnchor.constraint(equalTo: rightPill.centerYAnchor),
            leftPill.widthAnchor.constraint(equalToConstant: 222),
            leftPill.heightAnchor.constraint(equalToConstant: 44),
            rightPill.widthAnchor.constraint(equalToConstant: 146),
            rightPill.heightAnchor.constraint(equalToConstant: 44),
            notchGap.widthAnchor.constraint(equalToConstant: 138)
        ])

        collapsedRow.orientation = .horizontal
        collapsedRow.alignment = .centerY
        collapsedRow.spacing = 10
        collapsedRow.translatesAutoresizingMaskIntoConstraints = false
        collapsedRow.addArrangedSubview(leftPill)
        collapsedRow.addArrangedSubview(notchGap)
        collapsedRow.addArrangedSubview(rightPill)
        addSubview(collapsedRow)

        expandedPanel.translatesAutoresizingMaskIntoConstraints = false
        expandedTitleField.translatesAutoresizingMaskIntoConstraints = false
        expandedSubtitleField.translatesAutoresizingMaskIntoConstraints = false
        stateChip.translatesAutoresizingMaskIntoConstraints = false
        countChip.translatesAutoresizingMaskIntoConstraints = false
        expandedMetaStack.orientation = .horizontal
        expandedMetaStack.alignment = .centerY
        expandedMetaStack.spacing = 10
        expandedMetaStack.translatesAutoresizingMaskIntoConstraints = false
        let stateChipStack = makePillStack(fields: [stateChipField])
        let countChipStack = makePillStack(fields: [countChipField])
        stateChip.addSubview(stateChipStack)
        countChip.addSubview(countChipStack)
        NSLayoutConstraint.activate([
            stateChipStack.leadingAnchor.constraint(equalTo: stateChip.leadingAnchor, constant: 12),
            stateChipStack.trailingAnchor.constraint(equalTo: stateChip.trailingAnchor, constant: -12),
            stateChipStack.centerYAnchor.constraint(equalTo: stateChip.centerYAnchor),
            countChipStack.leadingAnchor.constraint(equalTo: countChip.leadingAnchor, constant: 12),
            countChipStack.trailingAnchor.constraint(equalTo: countChip.trailingAnchor, constant: -12),
            countChipStack.centerYAnchor.constraint(equalTo: countChip.centerYAnchor),
            stateChip.heightAnchor.constraint(equalToConstant: 28),
            countChip.heightAnchor.constraint(equalToConstant: 28)
        ])
        expandedMetaStack.addArrangedSubview(stateChip)
        expandedMetaStack.addArrangedSubview(countChip)
        pendingStack.orientation = .vertical
        pendingStack.alignment = .leading
        pendingStack.spacing = 10
        pendingStack.translatesAutoresizingMaskIntoConstraints = false
        expandedPanel.addSubview(expandedTitleField)
        expandedPanel.addSubview(expandedSubtitleField)
        expandedPanel.addSubview(expandedMetaStack)
        expandedPanel.addSubview(pendingStack)
        addSubview(expandedPanel)

        expandedHeightConstraint = expandedPanel.heightAnchor.constraint(equalToConstant: 0)
        expandedHeightConstraint?.isActive = true

        NSLayoutConstraint.activate([
            collapsedRow.leadingAnchor.constraint(equalTo: leadingAnchor),
            collapsedRow.trailingAnchor.constraint(equalTo: trailingAnchor),
            collapsedRow.topAnchor.constraint(equalTo: topAnchor),
            collapsedRow.heightAnchor.constraint(equalToConstant: 44),
            expandedPanel.leadingAnchor.constraint(equalTo: leadingAnchor),
            expandedPanel.trailingAnchor.constraint(equalTo: trailingAnchor),
            expandedPanel.topAnchor.constraint(equalTo: topAnchor),
            expandedPanel.bottomAnchor.constraint(equalTo: bottomAnchor),
            expandedTitleField.leadingAnchor.constraint(equalTo: expandedPanel.leadingAnchor, constant: 26),
            expandedTitleField.topAnchor.constraint(equalTo: expandedPanel.topAnchor, constant: 22),
            expandedMetaStack.trailingAnchor.constraint(equalTo: expandedPanel.trailingAnchor, constant: -24),
            expandedMetaStack.centerYAnchor.constraint(equalTo: expandedTitleField.centerYAnchor),
            expandedSubtitleField.leadingAnchor.constraint(equalTo: expandedPanel.leadingAnchor, constant: 26),
            expandedSubtitleField.trailingAnchor.constraint(equalTo: expandedPanel.trailingAnchor, constant: -26),
            expandedSubtitleField.topAnchor.constraint(equalTo: expandedTitleField.bottomAnchor, constant: 10),
            pendingStack.leadingAnchor.constraint(equalTo: expandedPanel.leadingAnchor, constant: 14),
            pendingStack.trailingAnchor.constraint(equalTo: expandedPanel.trailingAnchor, constant: -14),
            pendingStack.topAnchor.constraint(equalTo: expandedSubtitleField.bottomAnchor, constant: 16),
            pendingStack.bottomAnchor.constraint(equalTo: expandedPanel.bottomAnchor, constant: -14)
        ])
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func apply(payload: IslandPayload, isExpanded: Bool) {
        let isDarkMode = effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
        let primaryTextColor = isDarkMode ? NSColor.white : NSColor.black
        let secondaryTextColor = isDarkMode
            ? NSColor.white.withAlphaComponent(0.72)
            : NSColor.black.withAlphaComponent(0.58)
        let baseColor = (isDarkMode ? NSColor.black : NSColor.white).withAlphaComponent(0.96)
        let borderColor = borderColorForState(payload.state)

        leftPrimaryField.stringValue = collapsedStateTitle(payload.state)
        leftSecondaryField.stringValue = collapsedStateSubtitle(payload)
        rightPrimaryField.stringValue = "\(max(payload.counts.active_count, 0))"
        rightSecondaryField.stringValue = max(payload.counts.active_count, 0) == 1
            ? "task in progress"
            : "tasks in progress"

        leftPrimaryField.textColor = primaryTextColor
        leftSecondaryField.textColor = secondaryTextColor
        rightPrimaryField.textColor = primaryTextColor
        rightSecondaryField.textColor = secondaryTextColor
        expandedTitleField.textColor = primaryTextColor
        expandedSubtitleField.textColor = secondaryTextColor
        stateChipField.textColor = primaryTextColor
        countChipField.textColor = primaryTextColor
        expandedTitleField.stringValue = payload.focus?.title.isEmpty == false ? payload.focus!.title : payload.title
        expandedSubtitleField.stringValue = payload.pending_messages.isEmpty
            ? payload.detail
            : pendingMessageSummary(payload.pending_messages.count)
        stateChipField.stringValue = collapsedStateTitle(payload.state)
        countChipField.stringValue = "\(max(payload.counts.active_count, 0)) active"

        stylePill(leftPill, fillColor: baseColor, borderColor: borderColor)
        stylePill(rightPill, fillColor: baseColor, borderColor: borderColor.withAlphaComponent(0.48))
        stylePill(expandedPanel, fillColor: baseColor, borderColor: borderColor.withAlphaComponent(0.36))
        stylePill(stateChip, fillColor: (isDarkMode ? NSColor.white : NSColor.black).withAlphaComponent(0.08), borderColor: borderColor.withAlphaComponent(0.28))
        stylePill(countChip, fillColor: (isDarkMode ? NSColor.white : NSColor.black).withAlphaComponent(0.08), borderColor: borderColor.withAlphaComponent(0.22))

        rebuildPendingRows(payload.pending_messages, isDarkMode: isDarkMode)

        let shouldExpand = isExpanded && !payload.pending_messages.isEmpty
        collapsedRow.isHidden = shouldExpand
        expandedPanel.isHidden = !shouldExpand
        expandedHeightConstraint?.constant = shouldExpand
            ? (116 + CGFloat(payload.pending_messages.count) * 72)
            : 0
    }

    private func rebuildPendingRows(_ messages: [IslandPendingMessage], isDarkMode: Bool) {
        for view in pendingStack.arrangedSubviews {
            pendingStack.removeArrangedSubview(view)
            view.removeFromSuperview()
        }
        for message in messages {
            let row = MessageRowView(frame: .zero)
            row.translatesAutoresizingMaskIntoConstraints = false
            row.apply(message: message, isDarkMode: isDarkMode)
            row.widthAnchor.constraint(equalTo: pendingStack.widthAnchor).isActive = true
            row.heightAnchor.constraint(greaterThanOrEqualToConstant: 60).isActive = true
            pendingStack.addArrangedSubview(row)
        }
    }

    private func stylePill(_ pill: NSView, fillColor: NSColor, borderColor: NSColor) {
        pill.layer?.backgroundColor = fillColor.cgColor
        pill.layer?.borderColor = borderColor.cgColor
    }

    private func collapsedStateTitle(_ state: String) -> String {
        switch state {
        case "attention":
            return "Waiting"
        case "active":
            return "Active"
        case "done":
            return "Done"
        default:
            return "Idle"
        }
    }

    private func collapsedStateSubtitle(_ payload: IslandPayload) -> String {
        switch payload.state {
        case "attention":
            return payload.pending_messages.count == 1
                ? "Needs your reply"
                : "\(payload.pending_messages.count) messages pending"
        case "active":
            return payload.counts.running_count == 1
                ? "Task running"
                : "\(payload.counts.running_count) tasks running"
        case "done":
            return "Recently finished"
        default:
            return "Watching workspaces"
        }
    }

    private func pendingMessageSummary(_ count: Int) -> String {
        return count == 1
            ? "1 pending reply across your Codex workspaces"
            : "\(count) pending replies across your Codex workspaces"
    }

    private func borderColorForState(_ state: String) -> NSColor {
        switch state {
        case "attention":
            return NSColor.systemOrange.withAlphaComponent(0.82)
        case "done":
            return NSColor.systemGreen.withAlphaComponent(0.76)
        case "active":
            return NSColor.systemBlue.withAlphaComponent(0.72)
        default:
            return NSColor.systemGray.withAlphaComponent(0.32)
        }
    }

    private func makePillStack(fields: [NSTextField]) -> NSStackView {
        for field in fields {
            field.translatesAutoresizingMaskIntoConstraints = false
            field.lineBreakMode = .byTruncatingTail
        }
        let stack = NSStackView(views: fields)
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 2
        stack.translatesAutoresizingMaskIntoConstraints = false
        return stack
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    private let nodePath = ${swiftString(nodePath)}
    private let cliPath = ${swiftString(cliPath)}
    private let homeDir = ${swiftString(homeDir)}
    private let statusCwd = ${swiftString(statusCwd)}
    private let window = FloatingIslandWindow(
        contentRect: NSRect(x: 0, y: 0, width: 526, height: 44),
        styleMask: [.borderless],
        backing: .buffered,
        defer: false
    )
    private let panelView = IslandPanelView(frame: .zero)
    private var pollTimer: Timer?
    private var lastSignature = ""
    private var accessoryDemotionScheduled = false
    private var currentPayload: IslandPayload?
    private var isExpanded = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        configureWindow()
        if let payload = fetchPayload() {
            render(payload: payload, animate: false)
        } else {
            renderPlaceholder()
        }
        showWindow()
        startPolling()
    }

    func applicationWillTerminate(_ notification: Notification) {
        pollTimer?.invalidate()
    }

    private func configureWindow() {
        window.isOpaque = false
        window.backgroundColor = .clear
        window.hasShadow = true
        window.level = NSWindow.Level.floating
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        window.isMovableByWindowBackground = false
        window.standardWindowButton(.closeButton)?.isHidden = true
        window.standardWindowButton(.miniaturizeButton)?.isHidden = true
        window.standardWindowButton(.zoomButton)?.isHidden = true

        panelView.translatesAutoresizingMaskIntoConstraints = false
        let container = NSView(frame: window.contentView?.bounds ?? .zero)
        container.wantsLayer = true
        container.layer?.backgroundColor = NSColor.clear.cgColor
        container.addSubview(panelView)
        NSLayoutConstraint.activate([
            panelView.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            panelView.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            panelView.topAnchor.constraint(equalTo: container.topAnchor),
            panelView.bottomAnchor.constraint(equalTo: container.bottomAnchor)
        ])
        window.contentView = container

        let clickRecognizer = NSClickGestureRecognizer(target: self, action: #selector(handleClick))
        container.addGestureRecognizer(clickRecognizer)
        applyWindowFrame(width: 526, height: 44, animate: false)
    }

    private func startPolling() {
        pollTimer = Timer.scheduledTimer(withTimeInterval: 3.0, repeats: true) { [weak self] _ in
            self?.refresh()
        }
    }

    private func showWindow() {
        window.setIsVisible(true)
        window.orderFront(nil)
        window.orderFrontRegardless()
        scheduleAccessoryDemotionIfNeeded()
    }

    private func scheduleAccessoryDemotionIfNeeded() {
        if accessoryDemotionScheduled {
            return
        }
        accessoryDemotionScheduled = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
            NSApp.setActivationPolicy(.accessory)
        }
    }

    private func render(payload: IslandPayload, animate: Bool) {
        currentPayload = payload
        if payload.pending_messages.isEmpty {
            isExpanded = false
        }
        panelView.apply(payload: payload, isExpanded: isExpanded)
        layoutWindow(for: payload, animate: animate)
    }

    private func renderPlaceholder() {
        let placeholder = IslandPayload(
            ok: true,
            state: "idle",
            title: "Codex",
            subtitle: "Starting island",
            detail: "Loading global task state.",
            updated_at: "",
            counts: IslandCounts(
                workspaces_count: 0,
                known_sessions_count: 0,
                task_sessions_count: 0,
                active_count: 0,
                waiting_count: 0,
                running_count: 0
            ),
            focus: nil,
            pending_messages: []
        )
        render(payload: placeholder, animate: false)
    }

    @objc private func handleClick() {
        guard let payload = currentPayload else {
            return
        }
        if !payload.pending_messages.isEmpty {
            isExpanded.toggle()
            render(payload: payload, animate: true)
            showWindow()
            return
        }
        if let focus = payload.focus {
            NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: focus.session_path)])
        }
    }

    private func refresh() {
        guard let payload = fetchPayload() else { return }
        render(payload: payload, animate: true)

        let signature = [payload.state, payload.title, payload.detail, payload.focus?.updated_at ?? ""].joined(separator: "|")
        if signature != lastSignature {
            lastSignature = signature
        }
        showWindow()
    }

    private func fetchPayload() -> IslandPayload? {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: nodePath)
        process.arguments = [cliPath, "island", "status", "--json", "--home-dir", homeDir, "--cwd", statusCwd]
        let stdout = Pipe()
        let stderr = Pipe()
        process.standardOutput = stdout
        process.standardError = stderr

        do {
            try process.run()
            process.waitUntilExit()
            guard process.terminationStatus == 0 else { return nil }
            let data = stdout.fileHandleForReading.readDataToEndOfFile()
            return try JSONDecoder().decode(IslandPayload.self, from: data)
        } catch {
            return nil
        }
    }

    private func layoutWindow(for payload: IslandPayload, animate: Bool) {
        let width: CGFloat = isExpanded && !payload.pending_messages.isEmpty ? 980 : 526
        let height: CGFloat = isExpanded && !payload.pending_messages.isEmpty
            ? (116 + CGFloat(payload.pending_messages.count) * 72)
            : 44
        applyWindowFrame(width: width, height: height, animate: animate)
    }

    private func applyWindowFrame(width: CGFloat, height: CGFloat, animate: Bool) {
        guard let screen = preferredAnchorScreen() else { return }
        let visible = screen.visibleFrame
        let x = visible.midX - (width / 2)
        let y = visible.maxY - height - 10
        window.setFrame(NSRect(x: x, y: y, width: width, height: height), display: true, animate: animate)
    }

    private func preferredAnchorScreen() -> NSScreen? {
        let screens = NSScreen.screens
        if let menuBarScreen = screens.first(where: hasMenuBarInset) {
            return menuBarScreen
        }

        let mouseLocation = NSEvent.mouseLocation
        if let mouseScreen = screens.first(where: { NSMouseInRect(mouseLocation, $0.frame, false) }) {
            return mouseScreen
        }

        if let mainScreen = NSScreen.main {
            return mainScreen
        }

        return screens.first
    }

    private func hasMenuBarInset(_ screen: NSScreen) -> Bool {
        let frame = screen.frame
        let visible = screen.visibleFrame
        return abs(frame.maxY - visible.maxY) > 1 || abs(frame.minY - visible.minY) > 1
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
`;
}

function swiftString(value) {
  return JSON.stringify(String(value || ''));
}

function resolveSwiftcBin() {
  return process.env.OPENCODEX_SWIFTC_BIN || '/usr/bin/swiftc';
}

function pickCommandFailure(result) {
  const stderr = String(result?.stderr || '').trim();
  if (stderr) {
    return stderr;
  }
  const stdout = String(result?.stdout || '').trim();
  if (stdout) {
    return stdout;
  }
  return `exit code ${result?.code ?? 1}`;
}

async function openPath(targetPath) {
  const openResult = await runCommandCapture('/usr/bin/open', ['-g', targetPath], {
    cwd: process.cwd()
  });
  if (openResult.code !== 0) {
    throw new Error(`open failed: ${pickCommandFailure(openResult)}`);
  }
}
