import { Injectable, Logger } from '@nestjs/common'
import * as _ from 'lodash'
import * as fs from 'fs'
import { findFiles, getServiceNameFromPath, isNoSourceOfThisProject } from '../../source-code-analysis/file-analysis/analysis'

import { ConfigService } from '../../config/Config.service'
import { System, AsyncEventFlow } from '../../model/ms'

type ScanResult = {
  file: string,
  serviceName: string,
  exchangeName: string
}

@Injectable()
export class ExchangesFromSourceCodeProducer {
  private readonly logger = new Logger(ExchangesFromSourceCodeProducer.name)

  constructor(
    private readonly config: ConfigService
  ) { }

  public async transform(system: System): Promise<System> {
    const scanResults = await this.scanPathForExchangesInSendConfigurations(this.config.getSourceFolder())
    for (const scanResult of scanResults) {
      const sourceService = system.addMicroService(scanResult.serviceName, undefined, ExchangesFromSourceCodeProducer.name)
      const targetExchange = system.addMessageExchange(scanResult.exchangeName, undefined, ExchangesFromSourceCodeProducer.name)

      const eventFlow = new AsyncEventFlow(sourceService, targetExchange, undefined, ExchangesFromSourceCodeProducer.name)
      system.edges.push(eventFlow)

      this.logger.log(`added async event flow: ${sourceService.getPayload().name} -> ${targetExchange.getPayload().name}`)
    }
    return system
  }

  private async scanPathForExchangesInSendConfigurations(path: string): Promise<ScanResult[]> {
    this.logger.log('scanning for exchange in ' + path)
    const javaFiles = await findFiles(path, '.java')
    this.logger.log('found ' + javaFiles.length + ' java files')

    const sendConfigurations: ScanResult[] = []
    javaFiles
      .filter(file => isNoSourceOfThisProject(file) && isSendConfiguration(file))
      .forEach(file => {
        const exchangeNames = parseExchangeVariables(file)
        exchangeNames.forEach(exchangeName => {
          const serviceName = getServiceNameFromPath(path, file)
          sendConfigurations.push({ file, serviceName, exchangeName })
        })
      })

    this.logger.log('found ' + sendConfigurations.length + ' send configuration')
    return sendConfigurations
  }
}

function isSendConfiguration(file) {
  // TODO: make 'send' configurable
  return getFileNameWithoutPath(file).toLowerCase().includes('send') &&
    isNotPartOfMigration(file) &&
    isNotPartOfTestInSourceProject(file)
}

function isNotPartOfMigration(file) {
  // TODO: make this configurable
  return !file.toLowerCase().includes('migration')
}

function isNotPartOfTestInSourceProject(file) {
  // TODO: make this configurable
  return !file.toLowerCase().includes('test') || process.env.NODE_ENV === 'test'
}

function parseExchangeVariables(file: string): string[] {
  const exchangeNames: string[] = []

  const pattern = /exchange[\w]*[\s]*=\s*"(\w+)"/ig
  const fileContent = fs.readFileSync(file, 'utf8')
  let matches = pattern.exec(fileContent)
  while (matches != null) {
    exchangeNames.push(matches[1])
    matches = pattern.exec(fileContent)
  }

  return exchangeNames
}

function getFileNameWithoutPath(fileLocation) {
  const lastSlashIndex = fileLocation.lastIndexOf('/')
  return fileLocation.slice(lastSlashIndex + 1)
}