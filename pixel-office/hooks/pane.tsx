import { atom, read, update } from 'claude-code'
import type { On } from 'claude-code'

import { emptyScene } from './model'
import { agentDetails, altText, clockLabel, orgRows, renderOffice } from './render'
import { PANE } from './state'
import { STATIONS, STATION_ORDER } from './stations'

const ORG_MAX = 14
const sceneAtom = atom({ plugin: 'pixel-office', key: 'scene' } as const, emptyScene())
const legendAtom = atom({ plugin: 'pixel-office', key: 'legendOpen' } as const, false)
const selectedAtom = atom({ plugin: 'pixel-office', key: 'selected' } as const, null as string | null)
const STATUS_COLOR = { working: 'green', waiting: 'yellow', idle: 'gray', done: 'gray' } as const

export function registerPane(on: On): void {
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const scene = await read($, sceneAtom)
    const isLegendOpen = await read($, legendAtom)
    const selected = await read($, selectedAtom)
    const now = await $.clock.now()
    const rows = orgRows(scene)
    const shown = rows.slice(0, ORG_MAX)
    const hidden = rows.length - shown.length
    const details = selected === null ? [] : agentDetails(scene, selected, now)

    if (e.surface === 'terminal') {
      const { Box, Text } = $.ui.resolve(e)
      return (
        <Box flexDirection="column">
          <Text dimColor>Open this session in the Claude desktop app to see the pixel office.</Text>
          {shown.map(row => (
            <Text>
              {'  '.repeat(row.depth)}
              {row.label}: {row.status}, {row.place}
            </Text>
          ))}
          {scene.ticker.map(line => (
            <Text dimColor>
              {clockLabel(line.at)} {line.text}
            </Text>
          ))}
        </Box>
      )
    }

    const { Box, Text, Button, Svg } = $.ui.resolve(e)
    const orgWidth = Math.max(24, Math.min(40, Math.floor(e.props.bodyColumns / 2)))
    return (
      <Box flexDirection="column" gap={1}>
        <Svg source={renderOffice(scene, now)} alt={altText(scene)} />
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
            <Text bold>Who reports to whom</Text>
            {shown.map(row => (
              <Button
                key={`agent-${row.id}`}
                plain
                onPress={() => update($, selectedAtom, current => (current === row.id ? null : row.id))}
              >
                <Text color={STATUS_COLOR[row.status]} dimColor={row.status === 'done'}>
                  {'  '.repeat(row.depth)}
                  {row.label} · {row.status} · {row.place}
                </Text>
              </Button>
            ))}
            {hidden > 0 && <Text dimColor>+{hidden} more</Text>}
            {details.length > 0 && (
              <Box key="details" flexDirection="column" marginTop={1}>
                {details.map(line => (
                  <Text dimColor>{line}</Text>
                ))}
              </Box>
            )}
          </Box>
        </Box>
        <Button
          key="legend"
          label={isLegendOpen ? 'Hide legend' : 'Show legend'}
          onPress={() => update($, legendAtom, isOpen => !isOpen)}
        />
        {isLegendOpen && (
          <Box key="legend-list" flexDirection="column">
            {STATION_ORDER.map(id => (
              <Text color={STATIONS[id].color}>
                ■ {STATIONS[id].name}: {STATIONS[id].tools}
              </Text>
            ))}
          </Box>
        )}
      </Box>
    )
  })
}
