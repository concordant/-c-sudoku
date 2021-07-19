/**
 * MIT License
 *
 * Copyright (c) 2020, Concordant and contributors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import React from "react";
import assert from "assert";
import Grid from "./Grid";
import { GRIDS } from "../constants";
import { client } from "@concordant/c-client";
import Submit1Input from "./Submit1Input";

import CONFIG from "../config.json";

const TIMEOUTGET = 60000;

const session = client.Session.Companion.connect(
  CONFIG.dbName,
  CONFIG.serviceUrl,
  CONFIG.credentials
);

/**
 * Interface for the state of a Game.
 * Keep a reference to the opened session and opened MVMap.
 */
interface IGameState {
  gridNum: string;
  collection: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  mvmap: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  cells: { value: string; modifiable: boolean }[];
  isConnected: boolean;
}

/**
 * This class represent the Game that glues all components together.
 */
class Game extends React.Component<Record<string, unknown>, IGameState> {
  timeoutGet!: NodeJS.Timeout;
  modifiedCells: string[];

  constructor(props: Record<string, unknown>) {
    super(props);
    const cells = new Array(81)
      .fill(null)
      .map(() => ({ value: "", modifiable: false }));
    this.modifiedCells = new Array(81).fill(null);
    const gridNum = "1";
    const collection = session.openCollection(
      "sudoku",
      false,
      this.handler.bind(this)
    );
    const mvmap = collection.open("grid" + gridNum, "MVMap", false);
    this.state = {
      gridNum: gridNum,
      collection: collection,
      mvmap: mvmap,
      cells: cells,
      isConnected: true,
    };
  }

  /**
   * Called after the component is rendered.
   * It set a timer to refresh cells values.
   */
  componentDidMount(): void {
    this.initFrom(generateStaticGrid(this.state.gridNum));
    this.setGetTimeout();
  }

  /**
   * Called when the compenent is about to be removed from the DOM.
   * It remove the timer set in componentDidMount().
   */
  componentWillUnmount(): void {
    clearInterval(this.timeoutGet);
  }

  /**
   * Get remote changes
   */
  private setGetTimeout() {
    this.timeoutGet = setTimeout(() => {
      this.state.collection.forceGet(this.state.mvmap);
      this.setGetTimeout();
    }, TIMEOUTGET);
  }

  /**
   * Handles update
   */
  private handler() {
    this.pullGrid();
  }

  /**
   * Update cells values from C-Client.
   */
  pullGrid(): void {
    if (!this.state.isConnected) {
      return;
    }
    clearTimeout(this.timeoutGet);
    const cells = this.state.cells;
    this.state.collection.pull(client.utils.ConsistencyLevel.None);
    for (let index = 0; index < 81; index++) {
      if (cells[index].modifiable) {
        cells[index].value = "";
      }
    }
    session.transaction(client.utils.ConsistencyLevel.None, () => {
      const itString = this.state.mvmap.iteratorString();
      while (itString.hasNext()) {
        const val = itString.next();
        cells[val.first].value = hashSetToString(val.second);
      }
    });
    this.setState({ cells: cells });
    this.setGetTimeout();
  }

  /**
   * This function is used to simulate the offline mode.
   */
  switchConnection(): void {
    this.setState({ isConnected: !this.state.isConnected }, () => {
      if (this.state.isConnected) {
        session.transaction(client.utils.ConsistencyLevel.None, () => {
          for (let index = 0; index < 81; index++) {
            if (
              this.state.cells[index].modifiable &&
              this.modifiedCells[index] !== null
            ) {
              this.state.mvmap.setString(index, this.modifiedCells[index]);
            }
          }
        });
        this.pullGrid();
      } else {
        clearInterval(this.timeoutGet);
        this.modifiedCells = new Array(81).fill(null);
      }
    });
  }

  /**
   * Initialize the grid with the given values.
   * @param values values to be set in the grid.
   */
  initFrom(values: string): void {
    assert.ok(values.length === 81);
    const cells = this.state.cells;
    for (let index = 0; index < 81; index++) {
      cells[index].value = values[index] === "." ? "" : values[index];
      cells[index].modifiable = values[index] === "." ? true : false;
    }
    this.setState({ cells: cells });
  }

  /**
   * Reset the value of all modifiable cells.
   */
  reset(): void {
    const cells = this.state.cells;
    session.transaction(client.utils.ConsistencyLevel.None, () => {
      for (let index = 0; index < 81; index++) {
        if (cells[index].modifiable) {
          cells[index].value = "";
          if (this.state.isConnected) {
            this.state.mvmap.setString(index, cells[index].value);
          } else {
            this.modifiedCells[index] = "";
          }
        }
      }
    });
    this.setState({ cells: cells });
  }

  /**
   * This handler is called when the value of a cell is changed.
   * @param index The index of the cell changed.
   * @param value The new value of the cell.
   */
  handleChange(index: number, value: string): void {
    assert.ok(value === "" || (Number(value) >= 1 && Number(value) <= 9));
    assert.ok(index >= 0 && index < 81);
    if (!this.state.cells[index].modifiable) {
      console.error(
        "Trying to change an non modifiable cell. Should not happend"
      );
    }

    const cells = this.state.cells;
    cells[index].value = value;
    this.setState({ cells: cells });

    if (this.state.isConnected) {
      session.transaction(client.utils.ConsistencyLevel.None, () => {
        this.state.mvmap.setString(index, value);
      });
    } else {
      this.modifiedCells[index] = value;
    }
  }

  /**
   * This handler is called when a new grid number is submit.
   * @param gridNum Desired grid number.
   */
  handleSubmit(gridNum: string): void {
    if (
      Number(gridNum) < 1 ||
      Number(gridNum) > 100 ||
      gridNum === this.state.gridNum
    ) {
      return;
    }
    const mvmap = this.state.collection.open("grid" + gridNum, "MVMap", false);
    this.setState({ gridNum: gridNum, mvmap: mvmap });
    this.initFrom(generateStaticGrid(gridNum));
  }

  render(): JSX.Element {
    return (
      <div className="sudoku">
        <div>Current grid : {this.state.gridNum}</div>
        <Submit1Input
          inputName="Grid"
          onSubmit={this.handleSubmit.bind(this)}
        />
        <div>
          Difficulty levels: easy (1-20), medium (21-40), hard (41-60),
          very-hard (61-80), insane (81-100)
        </div>
        <br />
        <div>
          <button onClick={this.reset.bind(this)}>Reset</button>
        </div>
        <br />
        <div>
          <button onClick={() => this.switchConnection()}>
            {this.state.isConnected ? "Disconnect" : "Connect"}
          </button>
        </div>
        <br />
        <Grid
          cells={this.state.cells}
          onChange={(index: number, value: string) =>
            this.handleChange(index, value)
          }
        />
      </div>
    );
  }
}

/**
 * Return a predefined Sudoku grid as a string.
 * @param gridNum Desired grid number
 */
function generateStaticGrid(gridNum: string) {
  return GRIDS[gridNum];
}

/**
 * Concatenates all values of a HashSet as a String.
 * @param set HashSet to be concatenated.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function hashSetToString(set: any): string {
  const res = new Set();
  const it = set.iterator();
  while (it.hasNext()) {
    const val = it.next();
    if (val !== "") {
      res.add(val);
    }
  }
  return Array.from(res).sort().join(" ");
}

export default Game;
