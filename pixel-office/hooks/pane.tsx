import { atom, read, update } from 'claude-code'
import type { On } from 'claude-code'

import type { JobRecord } from '../types'
import { note } from './debuglog'
import { emptyScene, restore } from './model'
import { STATUS_WORDS, agentDetails, altText, clockLabel, fitSize, isCut, objectiveLine, officeLayers, officeSource, orgRows, svgSize } from './render'
import { historyLine, recapAlt, recapOf, recapRows, recapSummary, recapSvg, sessionLines, sessionTotals } from './recap'
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
const LINK = '#378add'
// The details lines a whole text belongs under.
const PARTS = [
  { part: 'brief', line: 'Brief: ' },
  { part: 'report', line: 'Report: ' },
] as const
// Coordinating wears the meeting room's teal: a boss waiting on its helpers, not on you.
const STATUS_COLOR = { working: 'green', coordinating: STATIONS.meeting.color, waiting: 'yellow', idle: 'gray', done: 'gray' } as const

export function registerPane(on: On, { isLayered, isDebug }: { isLayered: boolean; isDebug?: boolean } = { isLayered: false }): void {
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const scene = restore(await read($, sceneAtom))
    const isLegendOpen = await read($, legendAtom)
    const expanded = await read($, expandedAtom)
    const isJobOpen = await read($, jobOpenAtom)
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

    if (e.surface === 'terminal') {
      const { Box, Text } = $.ui.resolve(e)
      return (
        <Box flexDirection="column">
          <Text dimColor>Open this session in the Claude desktop app to see the pixel office.</Text>
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
        </Box>
      )
    }

    const { Box, Text, Button, Svg, Markdown, Client } = $.ui.resolve(e)
    const chosen = selected === null ? undefined : scene.agents[selected]
    const orgWidth = Math.max(24, Math.min(40, Math.floor(e.props.bodyColumns / 2)))
    // Every picture is drawn afresh at every render, as of now: the desktop starts a picture over whenever the pane is
    // drawn, even when its text is unchanged, so a picture kept from an earlier render would replay that moment.
    const layers = isLayered ? officeLayers(scene, now) : undefined
    if (isDebug === true) {
      note(
        'render',
        {
          mode: layers === undefined ? 'single' : 'layered',
          scroll: e.props.scroll?.offset ?? 0,
          columns: e.props.bodyColumns,
          selected: selected !== null,
          jobOpen: isJobOpen,
          legendOpen: isLegendOpen,
          agents: Object.keys(scene.agents).length,
        },
        now,
      )
      if (layers !== undefined) note('layers', { n: layers.agents.length }, now)
    }
    const officePicture =
      layers !== undefined
        ? layers.base.source
        : officeSource(scene, now)
    const size = fitSize(svgSize(officePicture), e.props.bodyColumns)
    const recapPicture = isJobOpen && recap !== null ? recapSvg(recap) : undefined
    return (
      <Box flexDirection="column" gap={1}>
        {isDebug === true && <Client key={PROBE_TOP} module="./probe.tsx" props={{ where: 'top' }} />}
        {layers === undefined ? (
          <Svg source={officePicture} alt={altText(scene)} {...size} />
        ) : (
          <Box key="office" position="relative">
            <Svg key="office-base" source={layers.base.source} alt={altText(scene)} {...size} />
            <Box key={layers.pet.key} position="absolute" top={0} left={0} width="100%" height="100%">
              <Svg key={layers.pet.key + '-svg'} source={layers.pet.source} alt="The office cat" {...size} />
            </Box>
            {layers.agents.map(layer => (
              // An absolute Box has no size unless it is given one, so each layer is given the parent's whole region.
              <Box key={layer.key} position="absolute" top={0} left={0} width="100%" height="100%">
                <Svg key={layer.key + '-svg'} source={layer.source} alt={'Layer for ' + layer.key.replace(/^agent-/, '')} {...size} />
              </Box>
            ))}
          </Box>
        )}
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
        <Box key="buttons" flexDirection="row" gap={2}>
          <Button
            key="legend"
            label={isLegendOpen ? 'Hide legend' : 'Show legend'}
            onPress={() => update($, legendAtom, isOpen => !isOpen)}
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
