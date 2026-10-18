import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, PluginOptions } from 'claude-code'

import type { JobRecord, PeerSession } from '../types'
import { note } from './debuglog'
import { emptyScene, restore } from './model'
import { PEERS_SHOWN, officeOf, peerKey, peerRows, peersHeading } from './peers'
import { LEAD_MS, STATUS_WORDS, agentDetails, altText, clockLabel, fitSize, isCut, objectiveLine, officeSource, orgRows, renderOffice, svgSize } from './render'
import { historyLine, recapAlt, recapOf, recapRows, recapSummary, recapSvg, sessionLines, sessionTotals } from './recap'
import { CANNOT, MANY_COPIES, SETTINGS, configKeyOf, currentValues, meaningOf, replyAfterSet, setReply } from './settings'
import type { Setting } from './settings'
import { PANE, PROBE_BOTTOM, PROBE_TOP } from './state'
import { STATIONS, STATION_ORDER } from './stations'

const ORG_MAX = 14
const sceneAtom = atom({ plugin: 'pixel-office', key: 'scene' } as const, emptyScene())
const legendAtom = atom({ plugin: 'pixel-office', key: 'legendOpen' } as const, false)
const selectedAtom = atom({ plugin: 'pixel-office', key: 'selected' } as const, null as string | null)
const clockAtom = atom({ plugin: 'pixel-office', key: 'clock' } as const, 0)
const expandedAtom = atom({ plugin: 'pixel-office', key: 'expanded' } as const, null as 'brief' | 'report' | null)
const jobOpenAtom = atom({ plugin: 'pixel-office', key: 'jobOpen' } as const, false)
const historyAtom = atom({ plugin: 'pixel-office', key: 'history' } as const, [] as JobRecord[])
const sessionAtom = atom({ plugin: 'pixel-office', key: 'session' } as const, [] as JobRecord[])
const othersAtom = atom({ plugin: 'pixel-office', key: 'others' } as const, [] as PeerSession[])
const lookingAtom = atom({ plugin: 'pixel-office', key: 'looking' } as const, null as string | null)
const lookedAtom = atom({ plugin: 'pixel-office', key: 'looked' } as const, null as PeerSession | null)
const settingsOpenAtom = atom({ plugin: 'pixel-office', key: 'settingsOpen' } as const, false)
const settingsNoteAtom = atom({ plugin: 'pixel-office', key: 'settingsNote' } as const, '')
const LINK = '#378add'
// The details lines a whole text belongs under.
const PARTS = [
  { part: 'brief', line: 'Brief: ' },
  { part: 'report', line: 'Report: ' },
] as const
// Coordinating wears the meeting room's teal: a boss waiting on its helpers, not on you.
const STATUS_COLOR = { working: 'green', coordinating: STATIONS.meeting.color, waiting: 'yellow', idle: 'gray', done: 'gray' } as const

// Changes one setting the way the `/config` menu does, and says how it went. pane.tsx and register.tsx each have
// this: the engine follows `$` only into a function of the same file.
async function changeSetting($: EngineInterface, setting: Setting, value: string): Promise<string> {
  let keys: string[] = []
  try {
    keys = (await $.config.list()).map(row => row.key)
  } catch {
    // An engine without the listing: the key is the plain one.
  }
  const key = configKeyOf(keys, setting.field)
  if (key === null) return setReply(setting, value, MANY_COPIES)
  let deny: string | undefined
  try {
    deny = (await $.config.set({ key, value })).deny
  } catch {
    return setReply(setting, value, CANNOT)
  }
  let stored: unknown
  try {
    stored = (await $.config.list()).find(row => row.key === key)?.value
  } catch {
    // Not listed: the change is taken at its word.
  }
  return replyAfterSet(setting, value, deny, stored)
}

export function registerPane(on: On, { isDebug, options = {} }: { isDebug?: boolean; options?: PluginOptions } = {}): void {
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const scene = restore(await read($, sceneAtom))
    const isLegendOpen = await read($, legendAtom)
    const expanded = await read($, expandedAtom)
    const isJobOpen = await read($, jobOpenAtom)
    const isSettingsOpen = await read($, settingsOpenAtom)
    const settingsNote = await read($, settingsNoteAtom)
    let configRows: Array<{ key: string; value: unknown }> = []
    if (isSettingsOpen) {
      try {
        configRows = await $.config.list()
      } catch {
        // An engine without the listing: the options the office loaded with.
      }
    }
    const values = currentValues(configRows, options)
    const history = await read($, historyAtom)
    const session = await read($, sessionAtom)
    const selected = await read($, selectedAtom)
    // Reading the clock atom subscribes the pane to it: each write from the flush timer redraws the pane.
    const now = Math.max(await $.clock.now(), await read($, clockAtom))
    const rows = orgRows(scene, now)
    const shown = rows.slice(0, ORG_MAX)
    const hidden = rows.length - shown.length
    const details = selected === null ? [] : agentDetails(scene, selected, now)
    const recap = recapOf(scene, now)
    // The other sessions on this computer. A row cannot take you to that session, but pressing it shows that
    // session's office in the picture, until it is pressed again or Back is.
    const others = await read($, othersAtom)
    const peers = peerRows(others.slice(0, PEERS_SHOWN), now)
    const peersHidden = others.length - peers.length
    const looking = await read($, lookingAtom)
    const lookedAt = await read($, lookedAtom)
    const looked = looking !== null && lookedAt !== null && peerKey(lookedAt) === looking ? lookedAt : null
    const lookIn = async (key: string): Promise<void> => {
      const next = looking === key ? null : key
      await update($, lookingAtom, () => next)
      await update($, lookedAtom, () => (next === null ? null : (others.find(p => peerKey(p) === next) ?? null)))
    }

    if (e.surface === 'terminal') {
      const { Box, Text } = $.ui.resolve(e)
      return (
        <Box flexDirection="column">
          <Text dimColor>Open this session in the Claude desktop app to see the pixel office. /office settings lists its settings.</Text>
          {shown.map(row => {
            const objective = objectiveLine(scene, row.id, row.depth, e.props.bodyColumns)
            return (
              <Box key={`row-${row.id}`} flexDirection="column">
                <Text wrap="truncate-end">
                  {'  '.repeat(row.depth)}
                  {row.label}: {STATUS_WORDS[row.status]}, {row.now}
                </Text>
                {objective !== '' && <Text dimColor>{objective}</Text>}
              </Box>
            )
          })}
          {scene.ticker.map(line => (
            <Text dimColor>
              {clockLabel(line.at)} {line.text}
            </Text>
          ))}
          {recap !== null && recapSummary(recap).map(line => <Text>{line}</Text>)}
          {recap !== null && sessionLines(sessionTotals(session, recap)).map(line => <Text>{line}</Text>)}
          {others.length > 0 && <Text bold>{peersHeading(others)}</Text>}
          {peers.map(row => (
            <Box key={`peer-${row.key}`} flexDirection="column">
              <Text wrap="truncate-end">  {row.line}</Text>
              {row.job !== '' && <Text dimColor wrap="truncate-end">    {row.job}</Text>}
            </Box>
          ))}
          {peersHidden > 0 && <Text dimColor>  +{peersHidden} more</Text>}
        </Box>
      )
    }

    const { Box, Text, Button, Svg, Markdown, Client } = $.ui.resolve(e)
    const chosen = selected === null ? undefined : scene.agents[selected]
    const orgWidth = Math.max(24, Math.min(40, Math.floor(e.props.bodyColumns / 2)))
    if (isDebug === true) {
      note(
        'render',
        {
          scroll: e.props.scroll?.offset ?? 0,
          columns: e.props.bodyColumns,
          selected: selected !== null,
          jobOpen: isJobOpen,
          legendOpen: isLegendOpen,
          agents: Object.keys(scene.agents).length,
        },
        now,
      )
    }
    // Drawn afresh at every render, as of now: the desktop starts the picture over whenever it draws the pane, even
    // when its text is unchanged, so a picture kept from an earlier render would replay that moment.
    // Another session's office is drawn by the same code from what its snapshot says: one picture, either way.
    const lookedScene = looked === null ? null : officeOf(looked, now + LEAD_MS)
    const officePicture = lookedScene === null ? officeSource(scene, now) : renderOffice(lookedScene, now + LEAD_MS)
    const lookedName = looked === null ? '' : peerRows([looked], now)[0]?.line ?? ''
    const size = fitSize(svgSize(officePicture), e.props.bodyColumns)
    const recapPicture = isJobOpen && recap !== null ? recapSvg(recap) : undefined
    return (
      <Box flexDirection="column" gap={1}>
        {isDebug === true && <Client key={PROBE_TOP} module="./probe.tsx" props={{ where: 'top' }} />}
        {looked !== null && (
          <Box key="looking" flexDirection="row" gap={2}>
            <Text bold color={STATUS_COLOR[looked.status]} wrap="truncate-end">
              Looking in on {lookedName}
            </Text>
            <Button key="back" label="Back to your office" onPress={() => lookIn(peerKey(looked))} />
          </Box>
        )}
        <Svg
          source={officePicture}
          alt={lookedScene === null ? altText(scene) : `Another session's office. ${altText(lookedScene)}`}
          {...size}
        />
        <Box flexDirection="row" gap={2}>
          <Box key="ticker" flexDirection="column" flexGrow={1}>
            <Text bold>What's happening</Text>
            {scene.ticker.length === 0 && <Text dimColor>Quiet so far. Agents appear as they start working.</Text>}
            {scene.ticker.map(line => (
              <Text wrap="truncate-end">
                {clockLabel(line.at)} {line.text}
              </Text>
            ))}
          </Box>
          <Box key="org" flexDirection="column" width={orgWidth}>
            <Text bold>Who's doing what</Text>
            {shown.map(row => {
              const objective = objectiveLine(scene, row.id, row.depth, orgWidth)
              return (
                <Box key={`row-${row.id}`} flexDirection="column">
                  <Button
                    key={`agent-${row.id}`}
                    plain
                    onPress={async () => {
                      await update($, selectedAtom, current => (current === row.id ? null : row.id))
                      await update($, expandedAtom, () => null)
                    }}
                  >
                    <Text color={STATUS_COLOR[row.status]} dimColor={row.status === 'done'} wrap="truncate-end">
                      {'  '.repeat(row.depth)}
                      {row.label} · {STATUS_WORDS[row.status]} · {row.now}
                    </Text>
                  </Button>
                  {objective !== '' && (
                    <Text color={row.status === 'done' ? 'gray' : undefined} dimColor>
                      {objective}
                    </Text>
                  )}
                </Box>
              )
            })}
            {hidden > 0 && <Text dimColor>+{hidden} more</Text>}
            {details.length > 0 && (
              <Box key="details" flexDirection="column" marginTop={1}>
                {details.map(line => {
                  // A brief or a report the line cuts short can be read whole, under its line.
                  const found = PARTS.find(p => line.startsWith(p.line))
                  const whole = found === undefined || chosen === undefined ? '' : chosen[found.part]
                  if (found === undefined || !isCut(whole)) return <Text dimColor>{line}</Text>
                  const isOpen = expanded === found.part
                  return (
                    <Box key={`part-${found.part}`} flexDirection="column">
                      <Text dimColor>{line}</Text>
                      <Button
                        key={`read-${found.part}`}
                        plain
                        onPress={() => update($, expandedAtom, current => (current === found.part ? null : found.part))}
                      >
                        <Text color={LINK}>{isOpen ? `Hide the full ${found.part}` : `Read the full ${found.part}`}</Text>
                      </Button>
                      {isOpen && <Markdown key={`full-${found.part}`} text={whole} />}
                    </Box>
                  )
                })}
              </Box>
            )}
          </Box>
        </Box>
        {others.length > 0 && (
          <Box key="peers" flexDirection="column">
            <Text bold>{peersHeading(others)}</Text>
            <Text dimColor>Press one to look in on its office.</Text>
            {peers.map(row => (
              <Box key={`peer-${row.key}`} flexDirection="column">
                <Button key={`look-${row.key}`} plain onPress={() => lookIn(row.key)}>
                  <Text color={STATUS_COLOR[row.status]} dimColor={row.status === 'idle'} bold={row.key === looking} wrap="truncate-end">
                    {row.key === looking ? '▸ ' : ''}
                    {row.line}
                  </Text>
                </Button>
                {row.job !== '' && (
                  <Text dimColor wrap="truncate-end">
                    {row.job}
                  </Text>
                )}
              </Box>
            ))}
            {peersHidden > 0 && <Text dimColor>+{peersHidden} more</Text>}
          </Box>
        )}
        <Box key="buttons" flexDirection="row" gap={2}>
          <Button
            key="legend"
            label={isLegendOpen ? 'Hide legend' : 'Show legend'}
            onPress={() => update($, legendAtom, isOpen => !isOpen)}
          />
          <Button
            key="settings"
            label={isSettingsOpen ? 'Hide settings' : 'Settings'}
            onPress={async () => {
              await update($, settingsOpenAtom, isOpen => !isOpen)
              await update($, settingsNoteAtom, () => '')
            }}
          />
          {recap !== null && (
            <Button
              key="job"
              label={isJobOpen ? 'Hide this job' : 'Show this job'}
              onPress={() => update($, jobOpenAtom, isOpen => !isOpen)}
            />
          )}
        </Box>
        {recapPicture !== undefined && recap !== null && (
          <Box key="job-view" flexDirection="column">
            {recapSummary(recap).map((line, i) => (
              <Text bold={i === 0}>{line}</Text>
            ))}
            {sessionLines(sessionTotals(session, recap)).map(line => (
              <Text>{line}</Text>
            ))}
            <Svg source={recapPicture} alt={recapAlt(recap)} {...svgSize(recapPicture)} />
            {recapRows(recap).map(line => (
              <Text dimColor>{line}</Text>
            ))}
            {history.length > 0 && (
              <Box key="history" flexDirection="column" marginTop={1}>
                <Text bold>Earlier jobs</Text>
                {[...history].reverse().map(record => (
                  <Text dimColor wrap="truncate-end">
                    {historyLine(record)}
                  </Text>
                ))}
              </Box>
            )}
          </Box>
        )}
        {isSettingsOpen && (
          <Box key="settings-list" flexDirection="column">
            <Text bold>Settings</Text>
            <Text dimColor>Press a value to switch to it. /config shows the same settings.</Text>
            {SETTINGS.map(setting => {
              const current = values[setting.field] ?? setting.fallback
              return (
                <Box key={`setting-${setting.field}`} flexDirection="column" marginTop={1}>
                  <Text>
                    {setting.title}: <Text bold>{current}</Text>
                    <Text dimColor>, {meaningOf(setting, current)}</Text>
                  </Text>
                  <Box flexDirection="row" gap={2}>
                    {setting.choices.map(choice => (
                      <Button
                        key={`set-${setting.field}-${choice.value}`}
                        plain
                        onPress={async () => {
                          // Said first: a change that takes loads the office again, and this press may not see the end of it.
                          await update($, settingsNoteAtom, () => setReply(setting, choice.value, undefined))
                          const said = await changeSetting($, setting, choice.value)
                          await update($, settingsNoteAtom, () => said)
                        }}
                      >
                        <Text color={choice.value === current ? undefined : LINK} bold={choice.value === current}>
                          {choice.value === current ? `● ${choice.value}` : `○ ${choice.value}`}
                        </Text>
                      </Button>
                    ))}
                  </Box>
                </Box>
              )
            })}
            {settingsNote !== '' && <Text color="yellow">{settingsNote}</Text>}
          </Box>
        )}
        {isLegendOpen && (
          <Box key="legend-list" flexDirection="column">
            {STATION_ORDER.map(id => (
              <Text color={STATIONS[id].color}>
                ■ {STATIONS[id].name}: {STATIONS[id].tools}
              </Text>
            ))}
          </Box>
        )}
        {isDebug === true && <Client key={PROBE_BOTTOM} module="./probe.tsx" props={{ where: 'bottom' }} />}
      </Box>
    )
  })
}
